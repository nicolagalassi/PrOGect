// ==UserScript==
// @name         Expedition Stats for OGame
// @namespace    https://github.com/nicolagalassi/progect
// @version      0.2.0
// @description  Reads the expedition reports you already have open and turns them into a distribution: what a common / rare / epic find actually pays as a share of your cap, today and on the days before, and how your universes compare on the one figure that travels between them. Standalone userscript, no dependencies.
// @author       nicolagalassi
// @match        https://*.ogame.gameforge.com/game/*
// @icon         https://gf1.geo.gfsrv.net/cdn3d/favicon.ico
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @license      MIT
// ==/UserScript==

/*
  Expedition Stats for OGame — a small, self-contained userscript.

  THE PROBLEM IT SOLVES
  An expedition resource find is not a free number: it is a percentage of a cap your account
  computes for itself. Metal is the cap; crystal tops out at half of it, deuterium at a third.
  Where a find lands inside that cap is what the game shows you as a RARITY:

        5% .. 24.999%  common (grey)
       25% .. 49.999%  rare   (blue)
       50% .. 100%     epic   (purple)

  The game tells you the band, and nothing else. It never tells you that today's "commons"
  all clustered at the bottom of the band, or that the 20-25% slice paid three times as often
  as the 5-10% one. That is the whole question this panel answers — and it keeps the answer
  for the days before, because one day of expeditions is far too small a sample to read.

  WHAT IT DOES
  - Reads the expedition reports ALREADY on screen when you open your message folder. Each
    resource find is normalised to a percentage of its own cap (metal = cap, crystal = cap/2,
    deuterium = cap/3), so metal, crystal and deuterium finds are directly comparable.
  - Histogram over the 5-100% range with a selectable slice width, the rarity bands drawn in,
    and the MOST HIT slice called out per band: "in 5-25% the peak is 12.5-15%, 7 finds".
  - A per-day history, kept indefinitely and in your browser only, so today can be read against
    yesterday, the last 7 days, or years of it. Nothing is deleted by age: a year of expeditions
    is a normal sample to read statistics on, and the whole archive costs about 230 kB a year at
    20 expeditions a day — a browser's 5 MB of storage holds a couple of decades of it. The only
    thing let go is the message ids past 180 days, which exist solely to avoid counting a report
    still sitting in the folder twice; the figures they were attached to stay.
  - A comparison ACROSS UNIVERSES, which is the one thing raw resources cannot give you: a 168M
    cap and a 43M cap have nothing in common in metal. What compares is how much of YOUR OWN cap
    an expedition brings back — caps collected divided by expeditions sent. That figure ignores
    cap size, economy speed, how many expedition slots you run, and the active item (which
    raises cap and loot together), so a difference between two universes is luck, depletion or
    position, not equipment. The absolute resources sit next to it, because that is what
    actually lands in the account, and that is where the cap and the item do show.
    It also answers "is today normal?" — today's yield against this universe's own 30-day
    average.
  - A cap panel showing the number it computed and every factor that went into it, plus a
    manual override, plus a CALIBRATION: the game labels each find with its own rarity, and
    a label plus an amount bracket the cap. Ten reports narrow it down considerably, and a
    find that lands outside its own band is the panel telling you the cap it used is wrong.

  WHERE THE DATA COMES FROM — all of it passive, not one server call
  Everything is read off pages you open yourself:
  - message folder (expedition tab) -> the reports, from the `.rawMessageData` block OGame
    renders next to every message (`rawExpeditionresult`, `rawResourcesgained`, `rawSize`, ...)
  - general ranking, page 1     -> the #1 score, which sets the cap step
  - overview                    -> active items (the expedition boosters among them)
  - Lifeform bonuses page       -> ResultBooster and the explorer-class bonus
  - any game page               -> universe economy speed and your character class
  Nothing is fetched, on a timer or otherwise. Anything not read yet is simply missing from
  the breakdown and the panel says so; the manual cap override covers the gap meanwhile.

  THE CAP FORMULA is the one OGLight uses (calcExpeditionMax), kept here so the numbers match
  the tool most players already read:
      step      = first row of the top-score table whose threshold >= the server's #1 score
      base      = explorer ? step.max * 3 * economySpeed : step.max * 2
      cap       = base * (1 + explorerClassLfBonus%) * (1 + resultBoosterLfBonus%) * itemBoost
  with one deliberate difference, commented at the point of use: the explorer-class LF bonus
  is applied only to an explorer, since on any other class it amplifies a class you do not have.

  COMPLIANCE (OGame Origin tool rules — see AGENTS.md):
  - §1.1  1 click = 1 action. This panel triggers NO game action at all. It reads and displays.
  - §1.2  No scheduling, nothing queued, nothing fired later.
  - §1.3/§4  No auto-refresh and no polling — in fact no server call whatsoever, not even on
          click. Every figure comes from the DOM of a page the player opened themselves, which
          is not a background call and adds no galaxy-view activity. The only observer here
          watches the DOM, never the network.
  - §4.1/§4.2  No `accountInfo`, no `cp=`: nothing mutates session state.
  - §1.4  No alarms. Nothing watches for an event and nothing notifies anybody.
  - §1.5  No alternative UI, no shortcut: the message folder stays where it is and is read as-is.
  - §1.6  Nothing here recreates a Dark Matter / Officer feature; it is a statistics view over
          reports the player already owns.
  - §1.7  CLOSED by default, anchored to the LEFT edge of the menu column and opening into the
          empty margin beside the game frame. It never hides, moves, resizes or covers the menu,
          the banners, the top ad bar, the footer, or Merchant / Officers / Shop.
  - §1.9  Nothing leaves the machine. The per-universe history and settings are localStorage;
          the cross-universe roll-up uses Tampermonkey's own storage, which is per SCRIPT rather
          than per origin — the only way a panel on one universe can see another, since every
          universe is its own subdomain. Both are local; the export button writes a file to your
          own disk. Without the grants the script still runs and simply shows one universe.
  - §5    Runs inside the OGame page and reads live game data -> needs toleration before it is
          distributed publicly.
*/

(function()
{
    'use strict';

    // The page's own window (serverTime, ogame, LocalizationStrings). With the GM grants above
    // the script runs in its own scope, so the page globals come from unsafeWindow; without them
    // (or in a plain browser) `window` already IS the page.
    const PAGE = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window;
    const HOST = window.location.host;
    const LS = {
        db:    'ogxs_db',    // per-day history: reports counted, finds recorded
        cfg:   'ogxs_cfg',   // cap sources + manual override + retention
        ui:    'ogxs_ui',    // scope / resource filter / slice width / view
        state: 'ogxs_state', // 'open' | 'closed'
        roll:  'ogxs_roll',  // one compact line per universe per day, shared across universes
    };

    // ------------------------------------------------------------------ the find model
    // A resource find is a fraction of the account's cap. Metal IS the cap; the other two
    // top out lower, so each resource is normalised against its own ceiling before anything
    // is compared or bucketed.
    const RES = ['metal', 'crystal', 'deut'];
    const CAP_FACTOR = { metal: 1, crystal: 1 / 2, deut: 1 / 3 };

    // The rarity bands, in percent of the resource's own cap. `to` is exclusive except on
    // the last band: a find of exactly 100% is the cap itself and is epic.
    const TIERS = [
        { key: 'common', from: 5,  to: 25  },
        { key: 'rare',   from: 25, to: 50  },
        { key: 'epic',   from: 50, to: 100 },
    ];
    const PCT_MIN = TIERS[0].from;                    // 5  — nothing is found below this
    const PCT_MAX = TIERS[TIERS.length - 1].to;       // 100 — the cap itself
    // OGame labels every find with its own size. This is the game's opinion of the band, and
    // the panel cross-checks it against the computed percentage: the two disagreeing is the
    // single clearest sign that the cap in use is wrong.
    const SIZE_TIER = { normal: 0, big: 1, huge: 2 };

    // ------------------------------------------------------------------ the cap model
    // Top-score steps, from OGLight's calcExpeditionMax: the first row whose threshold is at
    // or above the server's #1 score. `max` is the per-expedition metal ceiling before class,
    // speed, lifeform and item boosts.
    const TOP_STEPS = [
        { topScore: 10000,     max: 40000   },
        { topScore: 100000,    max: 500000  },
        { topScore: 1000000,   max: 1200000 },
        { topScore: 5000000,   max: 1800000 },
        { topScore: 25000000,  max: 2400000 },
        { topScore: 50000000,  max: 3000000 },
        { topScore: 75000000,  max: 3600000 },
        { topScore: 100000000, max: 4200000 },
        { topScore: Infinity,  max: 5000000 },
    ];
    // Expedition-result items by id, and what each adds. This is a FAST PATH, not a verdict:
    // OGame keeps adding variants (the same amplifier comes in several tiers and durations, each
    // with its own id), so an id missing from this list means nothing — readActiveItems falls
    // back to what the item says about itself.
    const ITEM_BOOST = {
        '83e5d5b5e3e6ba16eb73edd6731a25ed1feff8a1': 0.10,
        'f2f1bf68ded681adf6b45b24a8084b3861a5ce94': 0.15,
        'd831a85f8f53defc3e51b7551401b21fb98c28ad': 0.20,
        'fd38bf4fa0e07377c2a18556424eee14a6700654': 0.25,
        '7e05baae79bde905f5b2c89bb881d7ff04e8fa73': 0.30,
        '23c859c9f8b4ea7c562719ac829bfc9799250b33': 0.35,
        'a5ab323cadd8c172957451f8ddd9950f1c101966': 0.40,
    };

    // "expedition" in the languages OGame ships in. The buff bar names every item in the
    // player's own language, so this word — next to a percentage — is what identifies a booster
    // whose id this script has never seen. A miss is visible and fixable: every active item is
    // listed in the cap view and can be ticked by hand.
    const EXPE_WORD = /(exp[eé]d|sped|ekspe|wypraw|k[ae][sş]if|tutkimus|экспед|експед|αποστολ)/i;

    // Expedition outcomes, keyed the way OGame names them in `rawExpeditionresult`.
    const OUTCOMES = ['resource', 'darkmatter', 'ship', 'item', 'trader', 'pirate', 'alien', 'early', 'late', 'blackhole', 'nothing'];

    const MSG_EXPEDITION = '41'; // rawMessagetype of an expedition report

    // --------------------------------------------------------------------- styles
    // Design direction — "survey instrument": a dark, near-black ground so the histogram is
    // the only lit thing on the panel, and an amber accent for the tool's own chrome so it
    // never competes with the three colours that carry meaning here.
    // Colour is information in exactly one place: the rarity band. Grey = common, blue = rare,
    // violet = epic, the same three the game uses. Amber is never a band, only the tool.
    const CSS = `
        .ogxs_wrap{
            --ink:#080D13; --panel:#0E151E; --row:#161F2B; --row-hi:#1E2937;
            --line:#263444; --line-hi:#3A4E64;
            --acc:#FFB454; --acc-hi:#FFDCA8; --acc-dim:#7A5722;
            --cream:#E9F0F7; --mute:#93A5B6; --faint:#5E7183;
            --common:#9FB0C0; --rare:#4FA3FF; --epic:#B06CFF;
            --disp:"Bahnschrift","DIN Alternate","Roboto Condensed","Arial Narrow",Impact,sans-serif;
            --body:"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
            --mono:ui-monospace,"JetBrains Mono","SF Mono",Consolas,monospace;
            position:fixed;z-index:9000;display:flex;flex-direction:row-reverse;align-items:flex-start;
            font-family:var(--body);
        }
        .ogxs_wrap *{box-sizing:border-box}

        /* ---- closed: a lit spine on the edge of the menu ---- */
        .ogxs_tab{
            cursor:pointer;user-select:none;writing-mode:vertical-rl;text-orientation:mixed;
            padding:12px 5px;border:1px solid var(--acc-dim);border-right:none;border-radius:5px 0 0 5px;
            background:linear-gradient(180deg,#22190C,#0D1219);color:var(--acc);
            font-family:var(--disp);font-size:12px;font-weight:600;letter-spacing:1.4px;text-transform:uppercase;
            display:flex;align-items:center;gap:7px;box-shadow:-2px 2px 10px rgba(0,0,0,.55);
        }
        .ogxs_tab:hover{border-color:var(--acc);color:var(--acc-hi);background:linear-gradient(180deg,#31240F,#111722)}
        .ogxs_tabBadge{
            writing-mode:horizontal-tb;background:var(--acc);color:#0C1118;border-radius:7px;
            font-family:var(--mono);font-size:10px;font-weight:700;line-height:15px;padding:0 5px;
        }

        /* ---- open ---- */
        .ogxs_panel{
            width:398px;max-width:46vw;border:1px solid var(--line);border-right-color:var(--line-hi);
            border-radius:6px 0 0 6px;background:var(--ink);
            box-shadow:-4px 4px 18px rgba(0,0,0,.6);display:flex;flex-direction:column;
        }
        .ogxs_panel.ogxs_hidden,.ogxs_tab.ogxs_hidden{display:none}

        .ogxs_head{display:flex;align-items:center;gap:4px;padding:8px 9px 7px;border-bottom:1px solid var(--line)}
        .ogxs_brand{
            flex:1 1 auto;min-width:0;font-family:var(--disp);font-size:14px;font-weight:600;letter-spacing:1.6px;
            text-transform:uppercase;color:var(--acc);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
        }
        .ogxs_icon{
            cursor:pointer;color:var(--mute);font-size:13px;line-height:18px;width:22px;text-align:center;
            border:1px solid transparent;border-radius:3px;user-select:none;flex:0 0 auto;
        }
        .ogxs_icon:hover{color:var(--acc-hi);border-color:var(--line-hi);background:var(--row)}

        /* ---- view switch + filter chips ---- */
        .ogxs_views{display:flex;gap:0;border-bottom:1px solid var(--line)}
        .ogxs_view{
            flex:1 1 0;cursor:pointer;user-select:none;text-align:center;padding:6px 0 5px;
            font-family:var(--disp);font-size:11px;letter-spacing:1.2px;text-transform:uppercase;
            color:var(--faint);border-bottom:2px solid transparent;
        }
        .ogxs_view:hover{color:var(--cream)}
        .ogxs_view.ogxs_on{color:var(--acc);border-bottom-color:var(--acc)}
        .ogxs_chips{display:flex;gap:4px;flex-wrap:wrap;align-items:center;padding:7px 9px 0}
        .ogxs_chips+.ogxs_chips{padding-top:5px}
        .ogxs_chip{
            cursor:pointer;user-select:none;font-family:var(--disp);font-size:11px;letter-spacing:.8px;
            text-transform:uppercase;line-height:17px;padding:0 8px;border-radius:3px;
            border:1px solid var(--line);color:var(--mute);white-space:nowrap;
        }
        .ogxs_chip:hover{border-color:var(--line-hi);color:var(--cream)}
        .ogxs_chip.ogxs_on{border-color:var(--acc-dim);color:var(--acc);background:rgba(255,180,84,.14)}
        .ogxs_chipLabel{font-family:var(--disp);font-size:10px;letter-spacing:1.2px;text-transform:uppercase;color:var(--faint);margin-right:2px}

        .ogxs_body{overflow-y:auto;max-height:64vh;padding:0 9px 9px}
        .ogxs_body::-webkit-scrollbar{width:8px}
        .ogxs_body::-webkit-scrollbar-thumb{background:#263444;border-radius:4px}

        /* ---- headline: the answer, before any chart ---- */
        .ogxs_lead{
            margin-top:8px;padding:8px 9px;border:1px solid var(--line);border-left:2px solid var(--acc);
            border-radius:3px;background:linear-gradient(90deg,rgba(255,180,84,.08),var(--row))
        }
        .ogxs_leadTop{font-family:var(--disp);font-size:10px;letter-spacing:1.3px;text-transform:uppercase;color:var(--faint)}
        .ogxs_leadMain{font-family:var(--mono);font-size:17px;color:var(--acc-hi);margin-top:2px;letter-spacing:.5px}
        .ogxs_leadSub{font-size:10.5px;color:var(--mute);margin-top:3px}
        .ogxs_leadSub b{color:var(--cream);font-weight:600}

        /* ---- histogram ---- */
        .ogxs_chartWrap{margin-top:9px}
        .ogxs_chart{
            display:flex;align-items:flex-end;gap:1px;height:116px;padding:6px 6px 0;
            background:#05090E;border:1px solid var(--line);border-radius:3px 3px 0 0;position:relative;
        }
        .ogxs_grid{position:absolute;left:0;right:0;border-top:1px dashed rgba(147,165,182,.14);pointer-events:none}
        .ogxs_max{position:absolute;top:3px;right:7px;font-family:var(--mono);font-size:9px;color:var(--faint);pointer-events:none}
        .ogxs_bar{
            flex:1 1 0;min-width:2px;min-height:1px;position:relative;border-radius:1px 1px 0 0;
            background:var(--common);opacity:.82;
        }
        .ogxs_bar:hover{opacity:1}
        .ogxs_bar[data-t="1"]{background:var(--rare)}
        .ogxs_bar[data-t="2"]{background:var(--epic)}
        .ogxs_bar.ogxs_zero{background:#18222E;opacity:1}
        .ogxs_bar.ogxs_peak{opacity:1;box-shadow:0 0 0 1px var(--acc-hi),0 0 7px rgba(255,180,84,.55)}
        /* rarity edges, drawn exactly at 25% and 50% of the cap */
        .ogxs_divider{position:absolute;top:0;bottom:0;width:1px;background:rgba(233,240,247,.22);pointer-events:none}
        .ogxs_axis{
            position:relative;height:15px;border:1px solid var(--line);border-top:none;border-radius:0 0 3px 3px;
            background:#070C12;
        }
        .ogxs_axis span{
            position:absolute;top:1px;transform:translateX(-50%);font-family:var(--mono);font-size:9px;color:var(--faint);
        }
        .ogxs_axis span.ogxs_edge{color:var(--mute)}

        /* ---- per-band readout ---- */
        .ogxs_bands{margin-top:9px;display:flex;flex-direction:column;gap:5px}
        .ogxs_bandRow{
            display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--line);
            border-radius:3px;background:var(--row);
        }
        .ogxs_bandRow:hover{background:var(--row-hi)}
        .ogxs_dot{flex:0 0 8px;width:8px;height:8px;border-radius:2px;background:var(--common)}
        .ogxs_bandRow[data-t="1"] .ogxs_dot{background:var(--rare)}
        .ogxs_bandRow[data-t="2"] .ogxs_dot{background:var(--epic)}
        .ogxs_bandName{
            flex:0 0 74px;font-family:var(--disp);font-size:11.5px;letter-spacing:1px;text-transform:uppercase;color:var(--cream);
        }
        .ogxs_bandName em{display:block;font-family:var(--mono);font-style:normal;font-size:9px;color:var(--faint);letter-spacing:0}
        .ogxs_bandMain{flex:1 1 auto;min-width:0}
        .ogxs_bandPeak{font-family:var(--mono);font-size:11px;color:var(--faint);white-space:nowrap}
        .ogxs_bandPeak b{font-weight:400;font-size:13px;color:var(--acc-hi)}
        .ogxs_bandAbs{font-size:9.5px;color:var(--faint);font-family:var(--mono);margin-top:1px}
        .ogxs_bandCount{flex:0 0 auto;text-align:right;font-family:var(--mono);font-size:11px;color:var(--mute)}
        .ogxs_bandCount em{display:block;font-style:normal;font-size:9px;color:var(--faint)}
        .ogxs_share{height:3px;margin-top:4px;background:#0A1017;border-radius:2px;overflow:hidden}
        .ogxs_share>i{display:block;height:100%;background:var(--common)}
        .ogxs_bandRow[data-t="1"] .ogxs_share>i{background:var(--rare)}
        .ogxs_bandRow[data-t="2"] .ogxs_share>i{background:var(--epic)}

        /* ---- generic small table ---- */
        .ogxs_sec{
            display:flex;align-items:center;gap:6px;margin:11px 0 5px;font-family:var(--disp);
            font-size:10px;letter-spacing:1.4px;text-transform:uppercase;color:var(--faint);
        }
        .ogxs_sec::after{content:"";flex:1 1 auto;height:1px;background:var(--line)}
        .ogxs_kv{display:flex;justify-content:space-between;gap:8px;padding:3px 0;font-size:11px;color:var(--mute);border-bottom:1px solid rgba(38,52,68,.5)}
        .ogxs_kv b{font-family:var(--mono);font-weight:400;color:var(--cream)}
        .ogxs_kv.ogxs_strong b{color:var(--acc-hi)}
        .ogxs_note{font-size:10px;color:var(--faint);line-height:1.45;margin-top:6px}
        .ogxs_warn{
            margin-top:8px;padding:6px 8px;border:1px solid #6B4A1E;border-left:2px solid var(--acc);
            border-radius:3px;background:rgba(255,180,84,.07);font-size:10.5px;color:var(--acc-hi);line-height:1.45;
        }
        .ogxs_empty{padding:22px 10px;text-align:center;font-size:11px;color:var(--faint);line-height:1.6}

        /* ---- day history ---- */
        .ogxs_day{
            display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--line);
            border-radius:3px;background:var(--row);cursor:pointer;margin-bottom:5px;
        }
        .ogxs_day:hover{background:var(--row-hi);border-color:var(--line-hi)}
        .ogxs_day.ogxs_on{border-color:var(--acc-dim);box-shadow:inset 2px 0 0 var(--acc)}
        .ogxs_dayDate{flex:0 0 60px;font-family:var(--mono);font-size:11px;color:var(--cream)}
        .ogxs_dayDate em{display:block;font-style:normal;font-size:9px;color:var(--faint)}
        .ogxs_dayMid{flex:1 1 auto;min-width:0}
        .ogxs_stack{display:flex;height:5px;border-radius:2px;overflow:hidden;background:#0A1017}
        .ogxs_stack>i{display:block;height:100%}
        .ogxs_stack>i[data-t="0"]{background:var(--common)}
        .ogxs_stack>i[data-t="1"]{background:var(--rare)}
        .ogxs_stack>i[data-t="2"]{background:var(--epic)}
        .ogxs_dayLine{font-size:10px;color:var(--mute);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .ogxs_dayLine b{font-family:var(--mono);font-weight:400;color:var(--cream)}
        .ogxs_dayPeak{flex:0 0 auto;font-family:var(--mono);font-size:10.5px;color:var(--acc-hi);text-align:right}
        .ogxs_dayPeak em{display:block;font-style:normal;font-size:9px;color:var(--faint)}

        /* ---- universe comparison ---- */
        .ogxs_uni{border:1px solid var(--line);border-radius:3px;background:var(--row);padding:7px 8px;margin-bottom:6px}
        .ogxs_uni.ogxs_here{border-color:var(--acc-dim);box-shadow:inset 2px 0 0 var(--acc)}
        .ogxs_uniTop{display:flex;align-items:baseline;gap:6px}
        .ogxs_uniName{
            flex:1 1 auto;min-width:0;font-family:var(--disp);font-size:13px;letter-spacing:.9px;text-transform:uppercase;
            color:var(--cream);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
        }
        .ogxs_uniTag{flex:0 0 auto;font-family:var(--mono);font-size:9.5px;color:var(--faint)}
        .ogxs_uniHere{flex:0 0 auto;font-family:var(--disp);font-size:9px;letter-spacing:1px;text-transform:uppercase;color:var(--acc)}
        .ogxs_uniNums{display:flex;gap:5px;margin-top:6px}
        .ogxs_uniNums>div{flex:1 1 0;min-width:0;padding:4px 5px;border:1px solid var(--line);border-radius:3px;background:var(--ink)}
        .ogxs_uniNums b{display:block;font-family:var(--mono);font-size:14px;font-weight:400;color:var(--cream);white-space:nowrap}
        .ogxs_uniNums.ogxs_lead b{color:var(--acc-hi)}
        .ogxs_uniNums em{
            display:block;font-style:normal;font-family:var(--disp);font-size:8.5px;letter-spacing:.7px;
            text-transform:uppercase;color:var(--faint);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
        }
        .ogxs_uniNums>div:first-child b{color:var(--acc-hi);font-size:16px}
        .ogxs_uniBar{height:3px;margin-top:6px;background:#0A1017;border-radius:2px;overflow:hidden}
        .ogxs_uniBar>i{display:block;height:100%;background:linear-gradient(90deg,var(--acc-dim),var(--acc))}
        .ogxs_uniMeta{margin-top:5px;font-size:9.5px;color:var(--faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .ogxs_uniMeta b{font-family:var(--mono);font-weight:400;color:var(--mute)}
        .ogxs_delta{font-family:var(--mono);font-size:11px}
        .ogxs_delta.ogxs_up{color:#3BE8B0}
        .ogxs_delta.ogxs_down{color:#FF8A7A}

        /* ---- cap view ---- */
        .ogxs_cap{
            margin-top:8px;padding:9px;border:1px solid var(--line);border-radius:3px;
            background:linear-gradient(180deg,var(--row),var(--ink));text-align:center;
        }
        .ogxs_capNum{font-family:var(--mono);font-size:22px;color:var(--acc-hi);letter-spacing:.5px}
        .ogxs_capSub{font-family:var(--disp);font-size:10px;letter-spacing:1.3px;text-transform:uppercase;color:var(--faint);margin-top:1px}
        .ogxs_capRes{display:flex;gap:5px;margin-top:8px}
        .ogxs_capRes>div{flex:1 1 0;padding:5px 3px;border:1px solid var(--line);border-radius:3px;background:var(--ink)}
        .ogxs_capRes b{display:block;font-family:var(--mono);font-size:12px;color:var(--cream);font-weight:400}
        .ogxs_capRes em{display:block;font-style:normal;font-family:var(--disp);font-size:9px;letter-spacing:1px;text-transform:uppercase;color:var(--faint);margin-top:1px}
        .ogxs_field{display:flex;align-items:center;gap:6px;margin-top:7px}
        .ogxs_field label{flex:1 1 auto;font-size:11px;color:var(--mute)}
        .ogxs_field input{
            flex:0 0 116px;padding:4px 7px;border-radius:3px;border:1px solid var(--line);
            background:#05090E !important;color:var(--cream) !important;-webkit-text-fill-color:var(--cream);
            caret-color:var(--acc);font-family:var(--mono);font-size:11px;text-align:right;
        }
        .ogxs_field input:focus{outline:none;border-color:var(--acc-dim)}
        .ogxs_field input::placeholder{color:var(--faint);-webkit-text-fill-color:var(--faint)}
        .ogxs_btn{
            cursor:pointer;user-select:none;display:inline-flex;align-items:center;gap:5px;justify-content:center;
            padding:3px 9px;border:1px solid var(--line);border-radius:3px;background:var(--row);
            color:var(--mute);font-family:var(--disp);font-size:10.5px;letter-spacing:1px;text-transform:uppercase;
        }
        .ogxs_btn:hover{border-color:var(--acc-dim);color:var(--acc-hi);background:var(--row-hi)}
        .ogxs_btnRow{display:flex;gap:5px;margin-top:9px}
        .ogxs_btnRow .ogxs_btn{flex:1 1 0}
        .ogxs_src{display:flex;align-items:baseline;gap:6px;padding:3px 0;font-size:10.5px;color:var(--mute);border-bottom:1px solid rgba(38,52,68,.5)}
        .ogxs_src>span:first-child{flex:0 0 9px;color:var(--faint)}
        .ogxs_src.ogxs_ok>span:first-child{color:#3BE8B0}
        .ogxs_src>span:nth-child(2){flex:1 1 auto;min-width:0}
        .ogxs_src b{font-family:var(--mono);font-weight:400;color:var(--cream)}
        .ogxs_age{flex:0 0 auto;font-family:var(--mono);font-size:9.5px;color:var(--faint)}
        .ogxs_item{
            display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none;
            padding:3px 5px 3px 17px;font-size:10.5px;color:var(--faint);border-bottom:1px solid rgba(38,52,68,.5);
        }
        .ogxs_item:hover{color:var(--cream);background:var(--row)}
        .ogxs_item.ogxs_on{color:var(--mute)}
        .ogxs_tick{flex:0 0 auto;font-size:12px;line-height:1}
        .ogxs_item.ogxs_on .ogxs_tick{color:var(--acc)}
        .ogxs_itemName{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .ogxs_item b{flex:0 0 auto;font-family:var(--mono);font-weight:400;color:var(--cream)}
        .ogxs_item.ogxs_on b{color:var(--acc-hi)}
        .ogxs_src a{color:var(--acc);text-decoration:none}
        .ogxs_src a:hover{color:var(--acc-hi);text-decoration:underline}
        .ogxs_foot{
            display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 9px;
            border-top:1px solid var(--line);font-size:10px;color:var(--faint);
        }
        .ogxs_foot a{color:var(--acc);text-decoration:none}
        .ogxs_foot a:hover{color:var(--acc-hi);text-decoration:underline}
    `;

    function injectStyle()
    {
        if(document.getElementById('ogxs_style')) return;
        const s = document.createElement('style');
        s.id = 'ogxs_style';
        s.textContent = CSS;
        (document.head || document.documentElement).appendChild(s);
    }

    // --------------------------------------------------------------------- helpers
    const el = (tag, cls, parent, html) =>
    {
        const n = document.createElement(tag);
        if(cls) n.className = cls;
        if(html != null) n.innerHTML = html;
        if(parent) parent.appendChild(n);
        return n;
    };
    const txt = n => ((n && (n.textContent || '')) || '').replace(/\s+/g, ' ').trim();
    // OGame prints "1.000.000" (it/de) or "1,000,000" (en) — strip the thousands separators only.
    const num = v =>
    {
        const s = String(v == null ? '' : v).replace(/[^\d.,-]/g, '');
        if(!s) return 0;
        const n = parseFloat(s.replace(/[.,](?=\d{3}(\D|$))/g, '').replace(',', '.'));
        return isFinite(n) ? n : 0;
    };
    const int = v => Math.round(num(v));
    const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
    // The biggest number in a string, read token by token. A cell that holds several numbers
    // must never be read as one: "4.863.506.275" next to a "+6.529.473" delta concatenates
    // into a figure that is wrong by three orders of magnitude.
    const maxNumber = str =>
    {
        let best = 0;
        (String(str == null ? '' : str).match(/\d[\d.,\u00A0\u202F' ]*/g) || []).forEach(tok => { best = Math.max(best, int(tok)); });
        return best;
    };
    // An element's OWN text, ignoring anything another tool injected into it as a child.
    const ownText = node =>
    {
        if(!node) return '';
        let out = '';
        for(let i = 0; i < node.childNodes.length; i++) if(node.childNodes[i].nodeType === 3) out += node.childNodes[i].textContent;
        return out;
    };
    // The score inside a cell other tools have written into. Each element's own text is parsed
    // on its own and the largest result wins, because flattening the cell to one string is the
    // whole problem: "4.863.506.275" and a "+6.529.473" delta sitting next to each other with
    // no separator between them parse as one nonsense number whichever order they are in.
    // A delta is always smaller than the score it annotates, so the largest is the score.
    const numberIn = cell =>
    {
        if(!cell) return 0;
        let best = maxNumber(ownText(cell));
        cell.querySelectorAll('*').forEach(n => { best = Math.max(best, maxNumber(ownText(n))); });
        return best;
    };
    const fmtInt = n => Math.round(n || 0).toLocaleString();
    const fmtShort = n =>
    {
        n = Math.round(n || 0);
        if(Math.abs(n) >= 1e9) return (n / 1e9).toFixed(Math.abs(n) >= 1e10 ? 0 : 1) + 'G';
        if(Math.abs(n) >= 1e6) return (n / 1e6).toFixed(Math.abs(n) >= 1e7 ? 0 : 1) + 'M';
        if(Math.abs(n) >= 1e4) return Math.round(n / 1e3) + 'k';
        return String(n);
    };
    // Percentages are the unit of this whole tool, so they are printed in the page's own
    // decimal notation and never with more precision than the data carries.
    const DEC = (PAGE.LocalizationStrings && PAGE.LocalizationStrings.decimalPoint) || '.';
    const fmtPct = (v, d) =>
    {
        d = d == null ? 1 : d;
        let s = (Math.round(v * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d);
        // Trailing zeros go only when there is a decimal point to trim them from — stripping
        // them off a whole number would print 50% as 5%.
        if(s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
        return (s === '' ? '0' : s).replace('.', DEC) + '%';
    };
    const pad2 = n => (n < 10 ? '0' : '') + n;
    // How old a reading is. An item boost expires and the top-1 score moves, so a cap computed
    // from a week-old reading is worth being told about.
    const ago = ts =>
    {
        if(!ts) return '';
        const m = Math.floor((Date.now() - ts) / 60000);
        if(m < 1) return T.justNow;
        if(m < 60) return m + 'm';
        const h = Math.floor(m / 60);
        if(h < 24) return h + 'h';
        return Math.floor(h / 24) + (IT ? 'g' : 'd');
    };

    // Server day. OGame reports carry a client-side timestamp; the game's own day boundary is
    // the SERVER's, so the timestamp is shifted by the whole-hour difference the page exposes
    // between server clock and local clock — the same convention PrOGect/OGLight key stats by,
    // so the days here line up with the ones the player already reads there.
    function serverShift()
    {
        const st = PAGE.serverTime instanceof Date ? PAGE.serverTime.getTime() : (typeof PAGE.serverTime === 'number' ? PAGE.serverTime : 0);
        if(!st) return 0;
        return Math.round((st - Date.now()) / 3600000) * 3600000;
    }
    const dayKeyOf = clientMs =>
    {
        const d = new Date(clientMs + serverShift());
        return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    };
    const todayKey = () => dayKeyOf(Date.now());
    const shiftKey = back =>
    {
        const d = new Date(Date.now() + serverShift() - back * 86400000);
        return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    };
    const prettyDay = key =>
    {
        const p = key.split('-');
        return p[2] + '/' + p[1];
    };

    // --------------------------------------------------------------------- labels
    const IT = (document.documentElement.lang || PAGE.userLang || '').toLowerCase().indexOf('it') === 0;
    const T = {
        title:     IT ? 'Spedizioni' : 'Expeditions',
        vDist:     IT ? 'Distribuzione' : 'Distribution',
        vDays:     IT ? 'Giorni' : 'Days',
        vCap:      IT ? 'Cap' : 'Cap',
        vUni:      IT ? 'Universi' : 'Universes',
        yield:     IT ? 'resa' : 'yield',
        yieldOf:   IT ? 'di cap per spedizione' : 'of cap per expedition',
        capsDay:   IT ? 'cap / giorno' : 'caps / day',
        resDay:    IT ? 'risorse / g' : 'resources / day',
        expesDay:  IT ? 'sped / g' : 'exp / day',
        hitRate:   IT ? 'spedizioni con risorse' : 'expeditions paying resources',
        here:      IT ? 'sei qui' : 'you are here',
        inLine:    IT ? 'Oggi rispetto a te stesso' : 'Today against yourself',
        vsAvg:     IT ? 'media' : 'avg',
        onPar:     IT ? 'in linea' : 'on par',
        above:     IT ? 'sopra' : 'above',
        below:     IT ? 'sotto' : 'below',
        uniHint:   IT ? 'La <b>resa</b> è quanto rende una spedizione in frazione del TUO cap. Non dipende da quanto è grande il cap, da quante spedizioni lanci né dall\u2019item attivo (l\u2019item alza cap e bottino insieme): è l\u2019unico numero confrontabile fra universi. Le risorse assolute lì accanto sono ciò che incassi davvero, e lì l\u2019item si vede.'
                      : 'The <b>yield</b> is what one expedition brings back as a fraction of YOUR cap. It does not depend on how big that cap is, how many expeditions you run, or the active item (the item raises cap and loot together): it is the one figure that compares across universes. The absolute resources next to it are what actually lands in the account, and that is where the item shows.',
        oneUni:    IT ? 'Gli altri universi compaiono qui da soli, appena ci giochi con lo script installato.'
                      : 'Other universes appear here on their own, as soon as you play them with the script installed.',
        noShare:   IT ? 'Senza i permessi di Tampermonkey il confronto resta su questo universo: ogni universo ha un archivio separato.'
                      : 'Without the Tampermonkey grants the comparison stays on this universe: each universe keeps a separate archive.',
        noUniData: IT ? 'Nessuna spedizione registrata in questo periodo.' : 'No expedition recorded in this range.',
        heldHere:  IT ? 'In archivio su questo universo: {n} spedizioni su {d} giorni. Allarga il periodo per vederle.'
                      : 'On record for this universe: {n} expeditions over {d} days. Widen the range to see them.',
        scope:     IT ? 'Periodo' : 'Range',
        today:     IT ? 'Oggi' : 'Today',
        yest:      IT ? 'Ieri' : 'Yesterday',
        d7:        IT ? '7 gg' : '7 d',
        d30:       IT ? '30 gg' : '30 d',
        all:       IT ? 'Tutto' : 'All',
        res:       IT ? 'Risorsa' : 'Resource',
        allRes:    IT ? 'Tutte' : 'All',
        metal:     IT ? 'Metallo' : 'Metal',
        crystal:   IT ? 'Cristallo' : 'Crystal',
        deut:      IT ? 'Deuterio' : 'Deuterium',
        slice:     IT ? 'Fetta' : 'Slice',
        sliceTT:   IT ? 'Larghezza di una barra dell\u2019istogramma. Con 2,5% ogni barra conta i ritrovamenti caduti in una finestra larga 2,5 punti di cap: più stretta = più dettaglio, più rumore.'
                      : 'Width of one histogram bar. At 2.5% each bar counts the finds that landed in a 2.5-point window of the cap: narrower = more detail, more noise.',
        mostHit:   IT ? 'Fetta più colpita' : 'Most hit slice',
        ofFinds:   IT ? 'dei ritrovamenti' : 'of the finds',
        finds:     IT ? 'ritrovamenti' : 'finds',
        find:      IT ? 'ritrovamento' : 'find',
        expes:     IT ? 'spedizioni' : 'expeditions',
        common:    IT ? 'Comune' : 'Common',
        rare:      IT ? 'Raro' : 'Rare',
        epic:      IT ? 'Epico' : 'Epic',
        peak:      IT ? 'picco' : 'peak',
        meanShort: IT ? 'media' : 'avg',
        spread:    IT ? 'da' : 'range',
        avg:       IT ? 'Media' : 'Average',
        median:    IT ? 'Mediana' : 'Median',
        best:      IT ? 'Migliore' : 'Best',
        worst:     IT ? 'Peggiore' : 'Lowest',
        total:     IT ? 'Totale raccolto' : 'Total collected',
        outcomes:  IT ? 'Esiti delle spedizioni' : 'Expedition outcomes',
        summary:   IT ? 'Riepilogo' : 'Summary',
        history:   IT ? 'Storico' : 'History',
        noData:    IT ? 'Nessun dato ancora.<br>Apri la cartella messaggi sulla scheda <b>Spedizioni</b>: i rapporti già a schermo vengono letti da soli.'
                      : 'Nothing recorded yet.<br>Open your message folder on the <b>Expeditions</b> tab: the reports already on screen are read on their own.',
        noRange:   IT ? 'Nessun ritrovamento di risorse in questo periodo.' : 'No resource find in this range.',
        capTitle:  IT ? 'Cap metallo per spedizione' : 'Metal cap per expedition',
        capOf:     IT ? 'cap' : 'cap',
        sources:   IT ? 'Da dove arriva' : 'Where it comes from',
        override:  IT ? 'Cap manuale' : 'Manual cap',
        overrideTT:IT ? 'Lascia 0 per usare il valore calcolato' : 'Leave 0 to use the computed value',
        topScore:  IT ? 'Punteggio n.1' : 'Top-1 score',
        openRank:  IT ? 'apri la classifica generale' : 'open the general ranking',
        openOver:  IT ? 'apri la panoramica' : 'open the overview',
        openLf:    IT ? 'apri i bonus Forme di Vita' : 'open Lifeform bonuses',
        cls:       IT ? 'Classe' : 'Class',
        explorer:  IT ? 'Scopritore' : 'Discoverer',
        notExpl:   IT ? 'non scopritore' : 'not a discoverer',
        unknownCls:IT ? 'classe non letta' : 'class not read',
        speed:     IT ? 'Velocità eco' : 'Economy speed',
        lfClass:   IT ? 'Bonus LF classe' : 'LF class bonus',
        lfBoost:   IT ? 'Bonus LF spedizioni' : 'LF expedition bonus',
        items:     IT ? 'Item attivi' : 'Active items',
        itemHint:  IT ? 'Spunta un item se amplifica le spedizioni e non è stato riconosciuto.'
                      : 'Tick an item if it boosts expeditions and was not recognised.',
        never:     IT ? 'mai letto' : 'never read',
        justNow:   IT ? 'ora' : 'now',
        step:      IT ? 'Scalino' : 'Step',
        calib:     IT ? 'Calibrazione dai rapporti' : 'Calibration from the reports',
        calibTT:   IT ? 'Ogni rapporto porta la propria rarità: rarità + importo stringono il cap fra due valori.'
                      : 'Every report carries its own rarity: rarity + amount bracket the cap between two values.',
        recalc:    IT ? 'Ricalcola con il cap attuale' : 'Recompute with current cap',
        recalcTT:  IT ? 'Riscrive la percentuale di ogni ritrovamento in archivio usando il cap attuale.'
                      : 'Rewrites the percentage of every stored find using the current cap.',
        exportTT:  IT ? 'Salva l’archivio come file JSON sul tuo disco' : 'Save the history as a JSON file on your disk',
        export:    IT ? 'Esporta' : 'Export',
        reset:     IT ? 'Cancella' : 'Clear',
        resetAsk:  IT ? 'Cancellare tutto lo storico delle spedizioni?' : 'Delete the whole expedition history?',
        close:     IT ? 'Chiudi' : 'Close',
        capUnknown:IT ? 'Cap non ancora noto: apri una volta la <b>classifica generale</b> (il punteggio del n.1 decide lo scalino) oppure inserisci un cap manuale qui sotto. Finché manca, i ritrovamenti vengono registrati ma non possono essere messi in percentuale.'
                      : 'Cap not known yet: open the <b>general ranking</b> once (the #1 score sets the step) or type a manual cap below. Until then finds are recorded but cannot be turned into percentages.',
        outOfBand: IT ? 'ritrovamenti fuori dalla loro fascia: il cap in uso non torna.' : 'finds fall outside their own band: the cap in use does not add up.',
        mismatch:  IT ? 'rapporti in cui la rarità del gioco non coincide con la percentuale calcolata.' : 'reports where the game rarity does not match the computed percentage.',
        noCapFinds:IT ? 'ritrovamenti registrati senza cap noto.' : 'finds recorded with no known cap.',
        keptDays:  IT ? 'giorni in archivio' : 'days on record',
        keepFor:   IT ? 'Conserva gli ultimi' : 'Keeps the last',
        keepAll:   IT ? 'Niente viene cancellato: l\u2019archivio tiene tutto, anche anni. Gli id dei messaggi, che servono solo a non contare due volte un rapporto ancora in cartella, vengono lasciati andare dopo 180 giorni; i numeri restano.'
                      : 'Nothing is deleted: the archive keeps everything, years included. Message ids — which only exist to avoid counting a report still in the folder twice — are let go after 180 days; the figures stay.',
        archive:   IT ? 'Archivio' : 'Archive',
        size:      IT ? 'Spazio usato' : 'Space used',
        full:      IT ? 'Il browser ha rifiutato l\u2019ultimo salvataggio: lo spazio è esaurito. Esporta l\u2019archivio e poi cancellalo, oppure libera spazio per questo sito — finché resta pieno, le spedizioni nuove non vengono registrate.'
                      : 'The browser refused the last save: storage is full. Export the archive and then clear it, or free space for this site — while it stays full, new expeditions are not recorded.',
        // outcome labels
        o_resource:IT ? 'Risorse' : 'Resources',
        o_darkmatter: IT ? 'Materia oscura' : 'Dark matter',
        o_ship:    IT ? 'Relitti' : 'Shipwrecks',
        o_item:    IT ? 'Oggetti' : 'Items',
        o_trader:  IT ? 'Mercante' : 'Trader',
        o_pirate:  IT ? 'Pirati' : 'Pirates',
        o_alien:   IT ? 'Alieni' : 'Aliens',
        o_early:   IT ? 'Rientro anticipato' : 'Early return',
        o_late:    IT ? 'Rientro ritardato' : 'Delayed return',
        o_blackhole: IT ? 'Buco nero' : 'Black hole',
        o_nothing: IT ? 'Nulla' : 'Nothing',
    };
    const TIER_NAME = [T.common, T.rare, T.epic];
    const RES_NAME = { metal: T.metal, crystal: T.crystal, deut: T.deut };

    // --------------------------------------------------------------------- storage
    const readJSON = (k, fb) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? fb : v; } catch(e) { return fb; } };
    // The archive is kept for as long as the player wants it, so the browser's storage quota is
    // a real ceiling rather than a theoretical one. A write that fails must never pass unnoticed:
    // silently dropping today's expeditions is the one failure this tool cannot afford.
    // Tracked per key: the settings are a few hundred bytes and will keep saving long after the
    // archive has stopped fitting, so letting a successful write clear the flag would hide
    // exactly the failure that matters.
    const writeFailed = {};
    const storageProblem = () => Object.keys(writeFailed).length > 0;
    function writeRaw(k, raw)
    {
        try { localStorage.setItem(k, raw); delete writeFailed[k]; return true; }
        catch(e) { writeFailed[k] = 1; return false; }
    }
    const writeJSON = (k, v) => writeRaw(k, JSON.stringify(v));

    // db.days[key] = { ids:[msgId], out:{outcome:count}, f:[[clientTs, resIndex, amount, capUsed, gameTier, depletion]] }
    // A find keeps its AMOUNT and the cap in force when it was read, never a percentage: the cap
    // moves (items expire, the top-1 score steps up), and a stored percentage would quietly rot.
    let db = readJSON(LS.db, null);
    if(!db || db.v !== 1) db = { v: 1, days: {} };

    const CFG_DEFAULT = {
        manualCap: 0,
        keepDays: 0, // 0 = keep everything; a year of expeditions is a perfectly normal sample
        // last passive readings, each with the moment it was taken
        topScore: 0, topScoreAt: 0,
        isExplorer: null, classAt: 0,
        speed: 1,
        lfClass: 0, lfBoost: 0, lfAt: 0,
        items: [], itemsAt: 0, itemPick: {},
    };
    let cfg = Object.assign({}, CFG_DEFAULT, readJSON(LS.cfg, {}));
    // 90 days was this script's own first default and nothing in the UI could set it, so anyone
    // carrying it never chose it. Statistics are read over a year as readily as over a week.
    let cfgMigrated = false;
    if(cfg.keepDays === 90) { cfg.keepDays = 0; cfgMigrated = true; }
    // Items used to be stored as bare ids, back when a fixed table was the only way to read one.
    if(Array.isArray(cfg.items) && typeof cfg.items[0] === 'string')
    {
        cfg.items = cfg.items.map(u => ({ u: u, n: '', p: Math.round((ITEM_BOOST[u] || 0) * 100), a: true }));
    }
    // Whether an item counts towards the cap: the player's own answer if they gave one, else
    // whether it was recognised as an expedition booster.
    const itemOn = it => cfg.itemPick[it.u] == null ? !!it.a : !!cfg.itemPick[it.u];

    // How many expeditions a day holds. This used to be the length of the message-id list, which
    // tied the COUNT to the dedupe list and meant the ids could never be dropped — and they are
    // the one part of the archive that grows without ever being read again. The count is its own
    // number now; days written before this carry it over from the ids they still have.
    const dayN = day => !day ? 0 : (day.n != null ? day.n : (day.ids || []).length);
    Object.keys(db.days).forEach(k => { const d = db.days[k]; if(d.n == null) d.n = (d.ids || []).length; });

    // Message ids exist only to not count the same report twice while it is still in the game's
    // message folder. Long after OGame has purged it there is nothing left to deduplicate
    // against, so past this window the ids go and the day keeps its figures.
    const ID_KEEP_DAYS = 180;
    let ui = Object.assign({ view: 'dist', scope: 'today', res: 'all', slice: 2.5 }, readJSON(LS.ui, {}));
    let uiState = localStorage.getItem(LS.state) || 'closed'; // closed by default → covers nothing (§1.7)

    // Which universe this is. The name is the one the game prints under its logo.
    const UNI =
    {
        id:   (HOST.match(/\d+/) || [''])[0],
        lang: (document.querySelector('head meta[name="ogame-language"]') || {}).content || (HOST.split(/[-.]/)[1] || ''),
        name: (document.querySelector('head meta[name="ogame-universe-name"]') || {}).content || HOST.split('.')[0],
    };
    UNI.key = HOST.split('.')[0]; // "s999-en" — one origin, one universe

    // Comparing universes is the one thing localStorage cannot do: it is per origin, and every
    // universe is its own subdomain, so a panel on one can never see another. Tampermonkey's
    // storage is per SCRIPT instead, which is exactly what this needs. It is optional: without
    // the grants the roll-up falls back to localStorage and the panel simply shows the universe
    // you are on. Nothing leaves the machine either way (§1.9).
    const GM_OK = typeof GM_getValue === 'function' && typeof GM_setValue === 'function';
    function readRoll()
    {
        try
        {
            const raw = GM_OK ? GM_getValue(LS.roll, '') : (localStorage.getItem(LS.roll) || '');
            const v = raw ? JSON.parse(raw) : null;
            return v && v.v === 1 ? v : { v: 1, uni: {} };
        }
        catch(e) { return { v: 1, uni: {} }; }
    }
    function writeRoll(all)
    {
        try
        {
            const raw = JSON.stringify(all);
            if(GM_OK) { GM_setValue(LS.roll, raw); delete writeFailed[LS.roll]; }
            else writeRaw(LS.roll, raw);
        }
        catch(e) { writeFailed[LS.roll] = 1; }
    }

    // The cap feeds every percentage in the roll-up, so any settings change refreshes it.
    const saveCfg = () => { writeJSON(LS.cfg, cfg); rollUp(); };
    const saveUi = () => writeJSON(LS.ui, ui);
    // Day keys are zero-padded, so a plain string compare is a date compare.
    function dropOldDays()
    {
        if(!(cfg.keepDays > 0)) return 0; // keeping everything is the default
        const limit = shiftKey(cfg.keepDays - 1);
        let dropped = 0;
        Object.keys(db.days).forEach(k => { if(k < limit) { delete db.days[k]; dropped++; } });
        return dropped;
    }
    // Everything the archive no longer needs, without losing a single figure.
    function dropOldIds()
    {
        const limit = shiftKey(ID_KEEP_DAYS - 1);
        let dropped = 0;
        Object.keys(db.days).forEach(k =>
        {
            const d = db.days[k];
            if(k >= limit || !d.ids) return;
            if(d.n == null) d.n = d.ids.length;
            delete d.ids;
            dropped++;
        });
        return dropped;
    }
    function saveDb()
    {
        dropOldDays();
        dropOldIds();
        writeJSON(LS.db, db);
        rollUp(); // this universe's line in the shared comparison
    }

    // --------------------------------------------------------------------- the cap
    const stepFor = topScore => TOP_STEPS.find(e => e.topScore >= (topScore || 0)) || TOP_STEPS[TOP_STEPS.length - 1];

    // The formula OGLight computes the expedition ceiling with, so the figure here matches the
    // one most players already have in front of them.
    function computeCap()
    {
        const out = {
            manual: false, known: false,
            step: stepFor(cfg.topScore), base: 0, itemBoost: 1,
            lfClass: cfg.lfClass || 0, lfBoost: cfg.lfBoost || 0, max: 0,
        };

        if(cfg.manualCap > 0)
        {
            out.manual = true; out.known = true; out.max = Math.round(cfg.manualCap);
            return out;
        }
        // Without the top-1 score there is no step, and a guessed step would be worse than an
        // admitted gap: every percentage in the panel would be silently wrong.
        if(!cfg.topScore) return out;

        const explorer = cfg.isExplorer === true;
        out.base = explorer ? out.step.max * 3 * (cfg.speed || 1) : out.step.max * 2;
        (cfg.items || []).forEach(it => { if(itemOn(it)) out.itemBoost += (it.p || 0) / 100; });
        // The explorer-class lifeform bonus amplifies the discoverer class itself, so it is
        // applied only to a discoverer. OGLight multiplies it in for every class; on any other
        // class that inflates the cap by a bonus the account cannot use.
        const lfClassFactor = explorer ? (1 + out.lfClass / 100) : 1;
        out.max = Math.round(out.base * lfClassFactor * (1 + out.lfBoost / 100) * out.itemBoost);
        out.known = out.max > 0;
        return out;
    }
    const capFor = (res, capMax) => capMax * CAP_FACTOR[res];

    // --------------------------------------------------------------------- passive readers
    // Everything below reads the page the PLAYER opened. No fetch, no timer, no `cp=`
    // (§1.3/§4/§4.2): the data is already in the DOM, and reading it adds no activity.
    const currentPage = () =>
    {
        try { return new URLSearchParams(window.location.search).get('component') || ''; }
        catch(e) { return ''; }
    };

    // Which expedition boosters are RUNNING, read off the buff bar. Two things had to be
    // loosened here against a real account: the bar spells the id differently depending on the
    // client (`data-uuid` on the wrapper, `ref` on the link), and the id itself may be one this
    // script has never seen — the account that reported this was running
    // "Amplificatore risorse per spedizioni (40 %) Bronzo", whose id is in no OGLight table.
    // So an item is identified by what it declares: its own tooltip carries the name and the
    // percentage, in the player's language. Everything found is reported, flagged with whether
    // it was recognised, and the cap view lets the player correct the flag.
    // The shop page is deliberately excluded: there the same id appears for an item you merely
    // OWN, which says nothing about what is active.
    const ITEM_ATTRS = ['data-uuid', 'ref', 'data-item', 'data-itemid', 'data-item-id'];
    const ITEM_ID = /^[0-9a-f]{40}$/i;
    const attrOf = (node, name) => (node && node.getAttribute && node.getAttribute(name)) || '';

    function parseItem(node)
    {
        let uuid = '';
        for(let i = 0; i < ITEM_ATTRS.length && !uuid; i++)
        {
            const v = attrOf(node, ITEM_ATTRS[i]);
            if(ITEM_ID.test(v)) uuid = v.toLowerCase();
        }
        if(!uuid) return null;

        // The tooltip is "<name>|<html description>", on the element itself or on the link in it.
        let tip = attrOf(node, 'data-tooltip-title');
        if(!tip) tip = attrOf(node.querySelector && node.querySelector('[data-tooltip-title]'), 'data-tooltip-title');
        const name = (tip.split('|')[0] || '').replace(/\s+/g, ' ').trim();

        const known = ITEM_BOOST[uuid];
        // The percentage in the item's own NAME ("... (40 %) Bronzo"), which is the effect; the
        // description also carries a price and a duration, so the name is read first.
        const m = (name || tip).match(/(\d+(?:[.,]\d+)?)\s*%/);
        const pct = known != null ? Math.round(known * 100) : (m ? num(m[1]) : 0);
        if(!pct) return null;

        return { u: uuid, n: name.slice(0, 48), p: pct, a: known != null || EXPE_WORD.test(tip) };
    }

    let deepScans = 0; // the text search is a last resort, not something to repeat every mutation
    function readActiveItems()
    {
        const bar = document.querySelector('#buffBar, [id*="buffBar"], [class*="buffBar"]');
        const scope = bar || document.querySelector('#overviewcomponent') || document.body;
        const found = {};

        scope.querySelectorAll('[' + ITEM_ATTRS.join('],[') + ']').forEach(n =>
        {
            const it = parseItem(n);
            // The wrapper and the link inside it carry the same id; keep whichever read a name.
            if(it && (!found[it.u] || (!found[it.u].n && it.n))) found[it.u] = it;
        });

        if(!Object.keys(found).length)
        {
            // Nothing matched. Either no booster is running — the common case, and a perfectly
            // good answer — or this client hangs the id somewhere unusual. Searching the bar's
            // markup for the ids we do know settles that; over the whole page it is a heavier
            // read, so it is capped.
            if(bar || deepScans < 3)
            {
                if(!bar) deepScans++;
                const html = scope.innerHTML || '';
                Object.keys(ITEM_BOOST).forEach(u =>
                {
                    if(html.indexOf(u) >= 0) found[u] = { u: u, n: '', p: Math.round(ITEM_BOOST[u] * 100), a: true };
                });
            }
            // A page still building its bar is not an empty bar: say nothing rather than record
            // "no items" over a reading that was right.
            else if(!bar && !cfg.itemsAt) return null;
        }

        return Object.keys(found).sort().map(u => found[u]);
    }

    function readSources()
    {
        let changed = false;
        const page = currentPage();

        // Universe economy speed — published as a meta tag on every game page.
        const sp = parseInt((document.querySelector('head meta[name="ogame-universe-speed"]') || {}).content || '0', 10);
        if(sp > 0 && sp !== cfg.speed) { cfg.speed = sp; changed = true; }

        // Character class — the sprite in the header. Only the discoverer changes the cap, so
        // that is what is stored; an unrecognised sprite stays `null` and the panel says so
        // rather than assuming a class the account may not have.
        const sprite = document.querySelector('#characterclass .sprite, [id*="characterclass"] .sprite, [class*="characterClass"] .sprite');
        if(sprite)
        {
            const c = sprite.className || '';
            const isExpl = /explorer|discoverer/i.test(c) ? true : (/miner|collector|warrior|general/i.test(c) ? false : null);
            if(isExpl !== null && isExpl !== cfg.isExplorer) { cfg.isExplorer = isExpl; cfg.classAt = Date.now(); changed = true; }
        }

        // Active items — the buff bar on the overview is where the running ones are listed.
        if(page === 'overview')
        {
            const boosters = readActiveItems();
            if(boosters)
            {
                const sig = list => list.map(i => i.u + ':' + i.p + ':' + (i.a ? 1 : 0)).join(',');
                if(sig(boosters) !== sig(cfg.items || []))
                {
                    cfg.items = boosters; cfg.itemsAt = Date.now(); changed = true;
                }
                else if(!cfg.itemsAt) { cfg.itemsAt = Date.now(); changed = true; }
            }
        }

        // Lifeform bonuses — the totals the bonus page prints per category.
        if(page === 'lfbonuses' || document.querySelector('inner-bonus-item-heading[data-toggable]'))
        {
            let cls = null, boost = null;
            document.querySelectorAll('inner-bonus-item-heading[data-toggable]').forEach(n =>
            {
                const key = n.getAttribute('data-toggable');
                const val = num(txt(n.querySelector('.subCategoryBonus')));
                if(!isFinite(val)) return;
                if(key === 'ResultBooster') boost = val;         // expedition result bonus
                else if(key === '603') cls = val;                // discoverer class bonus
            });
            let moved = false;
            if(boost !== null && boost !== cfg.lfBoost) { cfg.lfBoost = boost; moved = true; }
            if(cls !== null && cls !== cfg.lfClass) { cfg.lfClass = cls; moved = true; }
            // Only a real change is worth a write: re-stamping the read time on every DOM
            // mutation would save and re-render on a loop.
            if(moved || ((boost !== null || cls !== null) && !cfg.lfAt)) { cfg.lfAt = Date.now(); changed = true; }
        }

        // Top-1 score — the general ranking, first page. The score of rank 1 picks the cap step.
        if(page === 'highscore')
        {
            // category 1 = players, type 0 = points. The globals are the game's own; when they
            // are missing the row is read anyway only if it really is rank 1.
            const cat = PAGE.currentCategory, type = PAGE.currentType;
            if((cat == null || cat == 1) && (type == null || type == 0))
            {
                document.querySelectorAll('#ranks tbody tr').forEach(line =>
                {
                    const posTxt = txt(line.querySelector('.position'));
                    const iconRank = (line.querySelector('.highscorePositionIcon') || {}).className || '';
                    const rank = int(posTxt) || int(iconRank.replace(/\D/g, ''));
                    if(rank !== 1) return;
                    // Other tools write into this cell: OGLight appends a since-last-read delta
                    // ("+6.529.473") inside it, and the game's own Δ column can too.
                    const score = numberIn(line.querySelector('.score'));
                    if(score > 0 && score !== cfg.topScore) { cfg.topScore = score; cfg.topScoreAt = Date.now(); changed = true; }
                    else if(score > 0 && !cfg.topScoreAt) { cfg.topScoreAt = Date.now(); changed = true; }
                });
            }
        }

        if(changed) saveCfg();
        return changed;
    }

    // ---- expedition reports -------------------------------------------------------------
    // The message list the player has open. Live DOM first; if the page has already handed the
    // markup to the game's own message object without rendering the raw block, that string is
    // parsed instead. Both are the same page load — neither is a server call.
    function messageNodes()
    {
        const live = Array.from(document.querySelectorAll('.msg')).filter(n => n.querySelector('.rawMessageData'));
        if(live.length) return live;

        const c = PAGE.ogame && PAGE.ogame.messages && PAGE.ogame.messages.content;
        const html = Array.isArray(c) ? c.join('') : (typeof c === 'string' ? c : '');
        if(!html) return [];
        try
        {
            return Array.from(new DOMParser().parseFromString(html, 'text/html').querySelectorAll('.msg'))
                .filter(n => n.querySelector('.rawMessageData'));
        }
        catch(e) { return []; }
    }

    // OGame names the outcome in `rawExpeditionresult`; the two navigation outcomes are told
    // apart by the delay the same report carries.
    function outcomeOf(d)
    {
        const r = d.rawExpeditionresult || '';
        if(r === 'ressources') return 'resource';
        if(r === 'darkmatter') return 'darkmatter';
        if(r === 'shipwrecks') return 'ship';
        if(r === 'items') return 'item';
        if(r === 'trader') return 'trader';
        if(r === 'combatPirates') return 'pirate';
        if(r === 'combatAliens') return 'alien';
        if(r === 'fleetLost') return 'blackhole';
        if(r === 'nothing') return 'nothing';
        if(r === 'navigation')
        {
            let nav = {};
            try { nav = JSON.parse(d.rawNavigation || '{}'); } catch(e) {}
            return (nav.returnTimeMultiplier || 1) < 1 ? 'early' : 'late';
        }
        return '';
    }

    function ingestMessages()
    {
        const nodes = messageNodes();
        if(!nodes.length) return false;

        const cap = computeCap();
        let added = 0;

        nodes.forEach(node =>
        {
            const raw = node.querySelector('.rawMessageData');
            const d = raw.dataset;
            if(String(d.rawMessagetype) !== MSG_EXPEDITION) return;

            const id = node.getAttribute('data-msg-id') || d.rawMessageid || '';
            if(!id) return;

            const ts = (parseInt(d.rawTimestamp || d.rawDatetime || '0', 10) || 0) * 1000;
            if(!ts) return;
            const key = dayKeyOf(ts);

            const day = db.days[key] = db.days[key] || { n: 0, ids: [], out: {}, f: [] };
            day.ids = day.ids || [];
            if(day.ids.indexOf(id) >= 0) return; // already counted — re-reading a page is free
            day.ids.push(id);
            day.n = (day.n || 0) + 1;
            added++;

            const outcome = outcomeOf(d);
            if(outcome) day.out[outcome] = (day.out[outcome] || 0) + 1;

            if(outcome !== 'resource') return;

            let res = {};
            try { res = JSON.parse(d.rawResourcesgained || '{}'); } catch(e) {}
            const gameTier = SIZE_TIER[String(d.rawSize || '').trim()];
            const depletion = parseInt(d.rawDepletion || '0', 10) || 0;

            RES.forEach((name, i) =>
            {
                const amount = Math.round(res[name === 'deut' ? 'deuterium' : name] || 0);
                if(amount <= 0) return;
                day.f.push([ts, i, amount, cap.known ? cap.max : 0, gameTier == null ? -1 : gameTier, depletion]);
            });
        });

        if(added) saveDb();
        return added > 0;
    }

    // --------------------------------------------------------------------- statistics
    const sortedDays = () => Object.keys(db.days).sort();

    function scopeDays(scope)
    {
        const keys = sortedDays();
        if(scope === 'all') return keys;
        if(scope === 'today') return keys.filter(k => k === todayKey());
        if(scope === 'yest') return keys.filter(k => k === shiftKey(1));
        if(scope === '7' || scope === '30')
        {
            const from = shiftKey(parseInt(scope, 10) - 1);
            return keys.filter(k => k >= from);
        }
        if(scope.indexOf('day:') === 0) return keys.filter(k => k === scope.slice(4));
        return keys;
    }

    // One find, expanded into what the panel actually reads. `pct` is null when the find was
    // recorded before any cap was known AND none is known now — it still counts as a find, it
    // just cannot be placed on the scale.
    function decorate(row, capNow)
    {
        const res = RES[row[1]];
        const cap = row[3] > 0 ? row[3] : (capNow > 0 ? capNow : 0);
        const ceiling = cap > 0 ? capFor(res, cap) : 0;
        const pct = ceiling > 0 ? (row[2] / ceiling) * 100 : null;
        let tier = -1;
        if(pct != null) for(let i = 0; i < TIERS.length; i++) if(pct >= TIERS[i].from && (pct < TIERS[i].to || i === TIERS.length - 1)) tier = i;
        return { ts: row[0], res: res, amount: row[2], cap: cap, pct: pct, tier: tier, gameTier: row[4], depletion: row[5] };
    }

    function gather(scope, resFilter)
    {
        const capNow = computeCap();
        const keys = scopeDays(scope);
        const out = {};
        let expes = 0, rows = [], resFinds = 0;

        keys.forEach(k =>
        {
            const day = db.days[k];
            if(!day) return;
            expes += dayN(day);
            Object.keys(day.out || {}).forEach(o => { out[o] = (out[o] || 0) + day.out[o]; });
            (day.f || []).forEach(f =>
            {
                resFinds++;
                const r = decorate(f, capNow.known ? capNow.max : 0);
                if(resFilter === 'all' || resFilter === r.res) rows.push(r);
            });
        });

        rows.sort((a, b) => a.ts - b.ts);
        return { keys: keys, rows: rows, out: out, expes: expes, resFinds: resFinds, cap: capNow };
    }

    // The histogram over 5-100%. A slice never straddles a band edge: the edges (25 and 50) are
    // exactly where the rarity changes, so every slice belongs to one band and one band only.
    function histogram(rows, slice)
    {
        const bins = [];
        TIERS.forEach((band, t) =>
        {
            for(let v = band.from; v < band.to - 1e-9; v += slice)
            {
                bins.push({ from: v, to: Math.min(v + slice, band.to), tier: t, count: 0, sum: 0, first: Math.abs(v - band.from) < 1e-9 });
            }
        });

        let placed = 0, below = 0, above = 0, noPct = 0;
        rows.forEach(r =>
        {
            if(r.pct == null) { noPct++; return; }
            if(r.pct < PCT_MIN) { below++; return; }
            if(r.pct > PCT_MAX) { above++; return; }
            // The last slice of a band owns its upper edge only for the epic band, whose 100%
            // IS the cap; elsewhere the edge belongs to the band above.
            let idx = -1;
            for(let i = 0; i < bins.length; i++)
            {
                const b = bins[i];
                if(r.pct >= b.from && (r.pct < b.to || (i === bins.length - 1 && r.pct <= b.to))) { idx = i; break; }
            }
            if(idx < 0) return;
            bins[idx].count++; bins[idx].sum += r.amount; placed++;
        });

        return { bins: bins, placed: placed, below: below, above: above, noPct: noPct };
    }

    const peakOf = (bins, tier) =>
    {
        let best = null;
        bins.forEach((b, i) =>
        {
            if(tier != null && b.tier !== tier) return;
            if(!b.count) return;
            if(!best || b.count > best.count) best = { i: i, from: b.from, to: b.to, count: b.count, tier: b.tier };
        });
        return best;
    };

    function describe(rows)
    {
        const pcts = rows.filter(r => r.pct != null).map(r => r.pct).sort((a, b) => a - b);
        const tiers = [0, 0, 0];
        let mismatch = 0, noPct = 0, sum = { metal: 0, crystal: 0, deut: 0 };
        rows.forEach(r =>
        {
            sum[r.res] += r.amount;
            if(r.pct == null) { noPct++; return; }
            if(r.tier >= 0) tiers[r.tier]++;
            // The game's own label against ours: they disagree only if the cap is off.
            if(r.gameTier >= 0 && r.tier >= 0 && r.gameTier !== r.tier) mismatch++;
        });
        return {
            n: rows.length, withPct: pcts.length, noPct: noPct, tiers: tiers, mismatch: mismatch, sum: sum,
            avg: pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : 0,
            median: pcts.length ? (pcts.length % 2 ? pcts[(pcts.length - 1) / 2] : (pcts[pcts.length / 2 - 1] + pcts[pcts.length / 2]) / 2) : 0,
            min: pcts.length ? pcts[0] : 0,
            max: pcts.length ? pcts[pcts.length - 1] : 0,
        };
    }

    // Calibration. The game labels every find with its rarity, and a rarity is a percentage
    // window: a `big` find of 900k crystal says the crystal ceiling is above 900k/0.5 and at
    // most 900k/0.25, hence the metal cap is in that window doubled. Each report narrows the
    // window; enough of them pin the cap down without reading a single extra byte from OGame.
    function calibrate(rows)
    {
        let lo = 0, hi = Infinity, n = 0;
        rows.forEach(r =>
        {
            if(!(r.gameTier >= 0) || !(r.amount > 0)) return;
            const band = TIERS[r.gameTier];
            const f = CAP_FACTOR[r.res];
            lo = Math.max(lo, (r.amount * 100 / band.to) / f);   // below this the find would be rarer
            hi = Math.min(hi, (r.amount * 100 / band.from) / f); // above this it would be commoner
            n++;
        });
        return { n: n, lo: lo, hi: hi, ok: n > 0 && lo <= hi };
    }

    // ---- the cross-universe roll-up ---------------------------------------------------------
    // What makes two universes comparable is NOT the resources: a 168M cap and a 43M cap can
    // never be compared in metal. What compares is how much of YOUR OWN cap an expedition
    // brings back. A find is already stored as a fraction of its own ceiling, so summing those
    // fractions gives "how many whole caps did this day pay", and dividing by the number of
    // expeditions gives the one number that travels between universes:
    //
    //      yield = caps collected / expeditions sent      ("% of cap per expedition")
    //
    // It is blind, by construction, to everything that differs between universes: cap size,
    // economy speed, how many expedition slots you run — and to the item boost too, since the
    // boost raises the cap and the finds together. Which is the useful part: if the two
    // universes have different yields, that is luck, depletion or position, not equipment.
    // The absolute resources are kept alongside it, because that is what actually lands in your
    // account, and THAT is where the item and the cap show up.
    function dayRoll(key, capMax)
    {
        const day = db.days[key] || { n: 0, out: {}, f: [] };
        let caps = 0, abs = 0, finds = 0;
        const t = [0, 0, 0];
        (day.f || []).forEach(f =>
        {
            const r = decorate(f, capMax);
            finds++;
            abs += r.amount;
            if(r.pct != null) caps += r.pct / 100;
            if(r.tier >= 0) t[r.tier]++;
        });
        return [dayN(day), finds, Math.round(caps * 1000) / 1000, abs, t[0], t[1], t[2]];
    }
    const R_EXPES = 0, R_FINDS = 1, R_CAPS = 2, R_ABS = 3, R_T0 = 4;

    // Rebuilt from the local history, which is the source of truth — so an archive that predates
    // this view, or one whose cap has just been corrected, lands in the comparison on the next
    // page load rather than waiting for the next expedition report to arrive.
    function rollUp()
    {
        const cap = computeCap();
        const entry = {
            n: UNI.name, l: UNI.lang, s: UNI.id,
            cap: cap.known ? cap.max : 0,
            item: Math.round((cap.itemBoost - 1) * 100),
            speed: cfg.speed, expl: !!cfg.isExplorer,
            d: {},
        };
        Object.keys(db.days).forEach(k => { entry.d[k] = dayRoll(k, cap.known ? cap.max : 0); });

        const all = readRoll();
        all.uni = all.uni || {};
        const prev = all.uni[UNI.key];
        // MERGE, never replace. The local archive is the truth for the days it still covers, but
        // it is not the only record: it is pruned by retention and a browser cleanup can empty it
        // outright, and neither of those is a reason to forget a universe's past in the
        // comparison. Days the archive still has are recomputed and win; days only the roll-up
        // remembers are kept. Clearing the history on purpose drops both — see the reset button.
        if(prev && prev.d) entry.d = Object.assign({}, prev.d, entry.d);

        // A universe with no days has nothing to compare. Not writing one keeps the roll-up to
        // the universes actually played, and stops a cleared history from coming straight back
        // as an empty entry on the save that follows it.
        if(!Object.keys(entry.d).length)
        {
            if(prev) { delete all.uni[UNI.key]; writeRoll(all); }
            return;
        }
        // Rebuilding on every page load is right; WRITING on every page load is not. The entry
        // carries no clock of its own, so an unchanged one compares equal and costs nothing.
        if(prev)
        {
            const bare = Object.assign({}, prev);
            delete bare.seen;
            if(JSON.stringify(bare) === JSON.stringify(entry)) return;
        }
        entry.seen = Date.now();
        all.uni[UNI.key] = entry;
        // Another universe's days age out on the same rule as this one's — which, by default,
        // means they do not: a comparison over a year is exactly what this view is for.
        if(cfg.keepDays > 0)
        {
            const limit = shiftKey(cfg.keepDays - 1);
            Object.keys(all.uni).forEach(k =>
            {
                const u = all.uni[k];
                Object.keys(u.d || {}).forEach(day => { if(day < limit) delete u.d[day]; });
            });
        }
        writeRoll(all);
    }

    // The calendar days a range covers, built from the CALENDAR and not from what this universe
    // happens to have recorded: another universe's days are its own, and filtering them through
    // this one's archive would hide every day you played there and not here.
    function rangeKeys(scope, all)
    {
        if(scope === 'today') return [todayKey()];
        if(scope === 'yest') return [shiftKey(1)];
        if(scope.indexOf('day:') === 0) return [scope.slice(4)];
        if(scope === '7' || scope === '30')
        {
            const out = [];
            for(let i = 0; i < parseInt(scope, 10); i++) out.push(shiftKey(i));
            return out;
        }
        // "all" — every day any universe has on record
        const seen = {};
        Object.keys((all && all.uni) || {}).forEach(k => Object.keys(all.uni[k].d || {}).forEach(d => { seen[d] = 1; }));
        Object.keys(db.days).forEach(d => { seen[d] = 1; });
        return Object.keys(seen).sort();
    }

    // One universe over a range of days, reduced to the figures the comparison shows. Days the
    // player did not play are left out: a universe you touched twice this week must not look
    // weak because of the five days you were not there.
    function uniStats(entry, keys)
    {
        let expes = 0, finds = 0, caps = 0, abs = 0, days = 0;
        keys.forEach(k =>
        {
            const d = (entry.d || {})[k];
            if(!d || !d[R_EXPES]) return;
            days++;
            expes += d[R_EXPES]; finds += d[R_FINDS]; caps += d[R_CAPS]; abs += d[R_ABS];
        });
        return {
            days: days, expes: expes, finds: finds, caps: caps, abs: abs,
            yield: expes ? (caps / expes) * 100 : 0,   // % of cap per expedition — the comparable one
            capsDay: days ? caps / days : 0,
            absDay: days ? abs / days : 0,
            expesDay: days ? expes / days : 0,
            hit: expes ? (finds / expes) * 100 : 0,
        };
    }

    // One day, summarised for the history list.
    function daySummary(key, capNow)
    {
        const day = db.days[key] || { n: 0, out: {}, f: [] };
        const rows = (day.f || []).map(f => decorate(f, capNow));
        const tiers = [0, 0, 0];
        let sum = 0;
        rows.forEach(r => { if(r.tier >= 0) tiers[r.tier]++; sum += r.amount; });
        const h = histogram(rows, ui.slice);
        return {
            key: key, expes: dayN(day), finds: rows.length, tiers: tiers, sum: sum,
            peak: peakOf(h.bins, null), nothing: day.out.nothing || 0,
        };
    }

    // --------------------------------------------------------------------- UI
    let wrap = null, panel = null, tab = null;

    function build()
    {
        injectStyle();
        if(wrap && wrap.isConnected) return;
        wrap = el('div', 'ogxs_wrap', document.body);
        tab = el('div', 'ogxs_tab', wrap);
        tab.addEventListener('click', () => setState('open'));
        panel = el('div', 'ogxs_panel', wrap);
        place();
        window.addEventListener('resize', place, { passive: true });
    }

    // Anchor to the LEFT EDGE of the menu column and open LEFTWARDS, into the empty margin
    // beside the game frame — so the panel never lands on top of the game's own content, its
    // menu, its banners or its footer (§1.7). Closed is the default state.
    function place()
    {
        if(!wrap) return;
        const links = document.querySelector('#links') || document.querySelector('#menuTable');
        const r = links ? links.getBoundingClientRect() : null;
        const edge = r ? r.left : 200;
        wrap.style.right = Math.max(0, window.innerWidth - edge) + 'px';
        wrap.style.left = 'auto';
        wrap.style.top = Math.max(8, r ? r.top : 120) + 'px';
        if(panel) panel.style.maxWidth = Math.max(180, edge - 8) + 'px';
    }

    function setState(s)
    {
        uiState = s;
        try { localStorage.setItem(LS.state, s); } catch(e) {}
        render();
    }

    // x position of a percentage on the chart, matching the bars' own box (6px padding).
    const posOf = v => 'calc(6px + (100% - 12px) * ' + ((v - PCT_MIN) / (PCT_MAX - PCT_MIN)) + ')';
    // What a percentage is worth in actual resources, for the resource currently on screen.
    const absOf = (pct, capMax, res) => (pct / 100) * capFor(res, capMax);
    const shownRes = () => ui.res === 'all' ? 'metal' : ui.res;

    function chip(parent, label, on, onClick, title)
    {
        const c = el('span', 'ogxs_chip' + (on ? ' ogxs_on' : ''), parent);
        c.textContent = label;
        if(title) c.title = title;
        c.addEventListener('click', onClick);
        return c;
    }

    function renderFilters(parent, rangeOnly)
    {
        const r1 = el('div', 'ogxs_chips', parent);
        el('span', 'ogxs_chipLabel', r1).textContent = T.scope;
        const scopes = [['today', T.today], ['yest', T.yest], ['7', T.d7], ['30', T.d30], ['all', T.all]];
        scopes.forEach(s => chip(r1, s[1], ui.scope === s[0], () => { ui.scope = s[0]; saveUi(); render(); }));
        if(ui.scope.indexOf('day:') === 0)
        {
            chip(r1, prettyDay(ui.scope.slice(4)), true, () => { ui.scope = 'today'; saveUi(); render(); });
        }

        if(rangeOnly) return;

        const r2 = el('div', 'ogxs_chips', parent);
        el('span', 'ogxs_chipLabel', r2).textContent = T.res;
        [['all', T.allRes], ['metal', T.metal], ['crystal', T.crystal], ['deut', T.deut]].forEach(s =>
            chip(r2, s[1], ui.res === s[0], () => { ui.res = s[0]; saveUi(); render(); }));
        const sliceLabel = el('span', 'ogxs_chipLabel', r2);
        sliceLabel.textContent = T.slice;
        sliceLabel.title = T.sliceTT;
        [1, 2.5, 5].forEach(w => chip(r2, fmtPct(w), ui.slice === w, () => { ui.slice = w; saveUi(); render(); }, T.sliceTT));
    }

    function renderDist(body)
    {
        const g = gather(ui.scope, ui.res);
        const cap = g.cap;
        const res = shownRes();

        if(!g.rows.length)
        {
            el('div', 'ogxs_empty', body, g.expes ? T.noRange : T.noData);
            if(!cap.known) el('div', 'ogxs_warn', body, T.capUnknown);
            return;
        }

        const h = histogram(g.rows, ui.slice);
        const stat = describe(g.rows);
        const peak = peakOf(h.bins, null);

        // ---- the answer first, in words ----
        const lead = el('div', 'ogxs_lead', body);
        el('div', 'ogxs_leadTop', lead).textContent = T.mostHit;
        if(peak)
        {
            el('div', 'ogxs_leadMain', lead).textContent = fmtPct(peak.from) + ' – ' + fmtPct(peak.to);
            const share = h.placed ? (peak.count / h.placed) * 100 : 0;
            const sub = el('div', 'ogxs_leadSub', lead);
            sub.innerHTML = '<b>' + peak.count + '</b> ' + (peak.count === 1 ? T.find : T.finds) + ' · <b>' + fmtPct(share, 0) + '</b> ' + T.ofFinds +
                ' · ' + TIER_NAME[peak.tier].toLowerCase() +
                (cap.known ? ' · <b>' + fmtShort(absOf(peak.from, cap.max, res)) + '–' + fmtShort(absOf(peak.to, cap.max, res)) + '</b> ' + RES_NAME[res].toLowerCase() : '');
        }
        else el('div', 'ogxs_leadMain', lead).textContent = '—';

        // ---- histogram ----
        const cw = el('div', 'ogxs_chartWrap', body);
        const chart = el('div', 'ogxs_chart', cw);
        const maxCount = h.bins.reduce((m, b) => Math.max(m, b.count), 0) || 1;
        // horizontal guide at half the tallest slice — enough to read a shape, not a grid to count on
        const guide = el('div', 'ogxs_grid', chart);
        guide.style.top = '50%';
        el('div', 'ogxs_max', chart).textContent = 'max ' + maxCount;

        h.bins.forEach(b =>
        {
            const bar = el('div', 'ogxs_bar' + (b.count ? '' : ' ogxs_zero') + (peak && peak.from === b.from && peak.tier === b.tier ? ' ogxs_peak' : ''), chart);
            bar.setAttribute('data-t', b.tier);
            bar.style.height = b.count ? Math.max(3, (b.count / maxCount) * 100) + '%' : '2px';
            bar.title = fmtPct(b.from) + ' – ' + fmtPct(b.to) + '  ·  ' + b.count + ' ' + (b.count === 1 ? T.find : T.finds) +
                (cap.known ? '\n' + fmtInt(Math.round(absOf(b.from, cap.max, res))) + ' – ' + fmtInt(Math.round(absOf(b.to, cap.max, res))) + ' ' + RES_NAME[res] : '');
        });
        // band dividers, drawn exactly where the rarity changes
        TIERS.slice(1).forEach(band =>
        {
            const d = el('div', 'ogxs_divider', chart);
            d.style.left = posOf(band.from);
        });

        const axis = el('div', 'ogxs_axis', cw);
        [PCT_MIN, 25, 50, 75, PCT_MAX].forEach(v =>
        {
            const s = el('span', (v === 25 || v === 50) ? 'ogxs_edge' : '', axis);
            s.textContent = v;
            s.style.left = posOf(v);
            // The two ends would hang half outside the axis if they were centred like the rest.
            if(v === PCT_MIN) s.style.transform = 'translateX(0)';
            else if(v === PCT_MAX) s.style.transform = 'translateX(-100%)';
        });

        // ---- one row per band: this is the "inside 5-25, what actually paid" readout ----
        const bands = el('div', 'ogxs_bands', body);
        // Per band: the average is what the panel leads with — "commons pay 15% of the cap on
        // average" is the sentence people actually want — with the most hit slice behind it.
        const byTier = [[], [], []];
        g.rows.forEach(r => { if(r.tier >= 0 && r.pct != null) byTier[r.tier].push(r.pct); });
        const mean = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

        TIERS.forEach((band, t) =>
        {
            const p = peakOf(h.bins, t);
            const count = stat.tiers[t];
            const avg = mean(byTier[t]);
            const row = el('div', 'ogxs_bandRow', bands);
            row.setAttribute('data-t', t);
            el('i', 'ogxs_dot', row);
            const name = el('div', 'ogxs_bandName', row);
            name.innerHTML = TIER_NAME[t] + '<em>' + band.from + '–' + band.to + '%</em>';
            const main = el('div', 'ogxs_bandMain', row);
            const pk = el('div', 'ogxs_bandPeak', main);
            if(count)
            {
                pk.innerHTML = '<b>' + T.meanShort + ' ' + fmtPct(avg) + '</b>' +
                    (p ? '  ·  ' + T.peak + ' ' + fmtPct(p.from) + '–' + fmtPct(p.to) + ' ×' + p.count : '');
                const lo = Math.min.apply(null, byTier[t]), hi = Math.max.apply(null, byTier[t]);
                el('div', 'ogxs_bandAbs', main).textContent =
                    (cap.known ? '\u2248 ' + fmtShort(absOf(avg, cap.max, res)) + ' ' + RES_NAME[res].toLowerCase() : '') +
                    // A spread only says something once there are two finds to spread between.
                    (count > 1 && hi > lo ? (cap.known ? '  ·  ' : '') + T.spread + ' ' + fmtPct(lo) + '–' + fmtPct(hi) : '');
            }
            else pk.textContent = '—';
            const share = el('div', 'ogxs_share', main);
            el('i', '', share).style.width = (stat.withPct ? (count / stat.withPct) * 100 : 0) + '%';
            const c = el('div', 'ogxs_bandCount', row);
            c.innerHTML = count + '<em>' + (stat.withPct ? fmtPct((count / stat.withPct) * 100, 0) : '—') + '</em>';
        });

        // ---- summary ----
        el('div', 'ogxs_sec', body).textContent = T.summary;
        const kv = (k, v, strong) =>
        {
            const d = el('div', 'ogxs_kv' + (strong ? ' ogxs_strong' : ''), body);
            el('span', '', d).textContent = k;
            el('b', '', d).textContent = v;
        };
        kv(T.finds + ' / ' + T.expes, stat.n + ' / ' + g.expes);
        kv(T.avg, stat.withPct ? fmtPct(stat.avg) : '—');
        kv(T.median, stat.withPct ? fmtPct(stat.median) : '—');
        kv(T.best, stat.withPct ? fmtPct(stat.max) : '—');
        kv(T.worst, stat.withPct ? fmtPct(stat.min) : '—');
        RES.forEach(r => { if(stat.sum[r] > 0) kv(T.total + ' · ' + RES_NAME[r], fmtInt(stat.sum[r])); });

        // ---- outcomes ----
        const outKeys = OUTCOMES.filter(o => g.out[o]);
        if(outKeys.length)
        {
            el('div', 'ogxs_sec', body).textContent = T.outcomes;
            outKeys.forEach(o =>
            {
                const d = el('div', 'ogxs_kv', body);
                el('span', '', d).textContent = T['o_' + o] || o;
                el('b', '', d).textContent = g.out[o] + '  (' + fmtPct(g.expes ? (g.out[o] / g.expes) * 100 : 0, 0) + ')';
            });
        }

        // ---- what does not add up ----
        const bad = [];
        if(h.below + h.above) bad.push('<b>' + (h.below + h.above) + '</b> ' + T.outOfBand);
        if(stat.mismatch) bad.push('<b>' + stat.mismatch + '</b> ' + T.mismatch);
        if(stat.noPct) bad.push('<b>' + stat.noPct + '</b> ' + T.noCapFinds);
        if(bad.length) el('div', 'ogxs_warn', body, bad.join('<br>'));
        if(!cap.known) el('div', 'ogxs_warn', body, T.capUnknown);
        if(storageProblem()) el('div', 'ogxs_warn', body, T.full);
    }

    function renderDays(body)
    {
        const cap = computeCap();
        const keys = sortedDays().reverse();
        if(!keys.length) { el('div', 'ogxs_empty', body, T.noData); return; }

        el('div', 'ogxs_sec', body).textContent = T.history + ' · ' + keys.length + ' ' + T.keptDays;

        keys.forEach(k =>
        {
            const s = daySummary(k, cap.known ? cap.max : 0);
            const row = el('div', 'ogxs_day' + (ui.scope === 'day:' + k ? ' ogxs_on' : ''), body);
            row.addEventListener('click', () => { ui.scope = 'day:' + k; ui.view = 'dist'; saveUi(); render(); });

            const d = el('div', 'ogxs_dayDate', row);
            d.innerHTML = prettyDay(k) + '<em>' + k.split('-')[0] + '</em>';

            const mid = el('div', 'ogxs_dayMid', row);
            const stack = el('div', 'ogxs_stack', mid);
            const tot = s.tiers[0] + s.tiers[1] + s.tiers[2];
            s.tiers.forEach((n, t) =>
            {
                if(!n) return;
                const i = el('i', '', stack);
                i.setAttribute('data-t', t);
                i.style.width = (n / tot) * 100 + '%';
                i.title = TIER_NAME[t] + ': ' + n;
            });
            el('div', 'ogxs_dayLine', mid).innerHTML =
                '<b>' + s.expes + '</b> ' + T.expes + ' · <b>' + s.finds + '</b> ' + (s.finds === 1 ? T.find : T.finds) +
                (s.sum ? ' · <b>' + fmtShort(s.sum) + '</b>' : '');

            const pk = el('div', 'ogxs_dayPeak', row);
            pk.innerHTML = s.peak ? fmtPct(s.peak.from) + '–' + fmtPct(s.peak.to) + '<em>' + T.peak + ' \u00D7' + s.peak.count + '</em>' : '—';
        });
    }

    function renderUnis(body)
    {
        const all = readRoll();
        const keys = rangeKeys(ui.scope, all);
        const rows = Object.keys(all.uni || {})
            .map(k => ({ key: k, e: all.uni[k], s: uniStats(all.uni[k], keys) }))
            .filter(r => r.s.expes > 0)
            .sort((a, b) => b.s.yield - a.s.yield);

        // "Am I having a normal day?" is a question about yourself, not about other universes:
        // today's yield against this universe's own 30-day average answers it in one line.
        const here = (all.uni || {})[UNI.key];
        if(here)
        {
            const today = uniStats(here, [todayKey()]);
            const ref = uniStats(here, rangeKeys('30', all).filter(k => k !== todayKey()));
            if(today.expes && ref.expes)
            {
                const d = today.yield - ref.yield;
                const near = Math.abs(d) < ref.yield * 0.1;
                const lead = el('div', 'ogxs_lead', body);
                el('div', 'ogxs_leadTop', lead).textContent = T.inLine;
                el('div', 'ogxs_leadMain', lead).innerHTML = fmtPct(today.yield) +
                    '  <span class="ogxs_delta ' + (near ? '' : (d > 0 ? 'ogxs_up' : 'ogxs_down')) + '">' +
                    (d >= 0 ? '+' : '\u2212') + fmtPct(Math.abs(d)) + '</span>';
                el('div', 'ogxs_leadSub', lead).innerHTML =
                    (near ? T.onPar : (d > 0 ? T.above : T.below)) + ' · ' + T.vsAvg + ' 30' + (IT ? 'gg' : 'd') +
                    ' <b>' + fmtPct(ref.yield) + '</b> · ' + T.yieldOf;
            }
        }

        if(!rows.length)
        {
            // Say what the archive does hold, so an empty range is never mistaken for lost data.
            const held = Object.keys(db.days).reduce((n, k) => n + dayN(db.days[k]), 0);
            el('div', 'ogxs_empty', body, T.noUniData +
                (held ? '<br><br>' + T.heldHere.replace('{n}', '<b>' + held + '</b>').replace('{d}', '<b>' + Object.keys(db.days).length + '</b>') : ''));
            return;
        }

        el('div', 'ogxs_sec', body).textContent = T.vUni + ' · ' + rows.length;
        const best = rows[0].s.yield || 1;

        rows.forEach(r =>
        {
            const st = r.s;
            const box = el('div', 'ogxs_uni' + (r.key === UNI.key ? ' ogxs_here' : ''), body);
            const top = el('div', 'ogxs_uniTop', box);
            el('div', 'ogxs_uniName', top).textContent = r.e.n || r.key;
            el('div', 'ogxs_uniTag', top).textContent = r.key;
            if(r.key === UNI.key) el('div', 'ogxs_uniHere', top).textContent = T.here;

            const nums = el('div', 'ogxs_uniNums', box);
            const cell = (v, label) => { const d = el('div', '', nums); el('b', '', d).textContent = v; el('em', '', d).textContent = label; };
            cell(fmtPct(st.yield), T.yield + ' / ' + T.expesDay.split(' ')[0]);
            cell((Math.round(st.capsDay * 100) / 100).toString().replace('.', DEC), T.capsDay);
            cell(fmtShort(st.absDay), T.resDay);

            el('i', '', el('div', 'ogxs_uniBar', box)).style.width = clamp((st.yield / best) * 100, 2, 100) + '%';

            el('div', 'ogxs_uniMeta', box).innerHTML =
                'cap <b>' + (r.e.cap ? fmtShort(r.e.cap) : '?') + '</b> · item <b>' + (r.e.item ? '+' + r.e.item + '%' : '—') +
                '</b> · <b>' + (Math.round(st.expesDay * 10) / 10).toString().replace('.', DEC) + '</b> ' + T.expesDay +
                ' · <b>' + fmtPct(st.hit, 0) + '</b> ' + T.hitRate +
                ' · <b>' + st.days + '</b> ' + (IT ? 'gg' : 'd');
        });

        el('div', 'ogxs_note', body).innerHTML = T.uniHint;
        if(rows.length < 2) el('div', 'ogxs_note', body).innerHTML = GM_OK ? T.oneUni : T.noShare;
    }

    function renderCap(body)
    {
        const cap = computeCap();

        const box = el('div', 'ogxs_cap', body);
        el('div', 'ogxs_capNum', box).textContent = cap.known ? fmtInt(cap.max) : '—';
        el('div', 'ogxs_capSub', box).textContent = T.capTitle + (cap.manual ? ' · ' + T.override.toLowerCase() : '');
        const res = el('div', 'ogxs_capRes', box);
        RES.forEach(r =>
        {
            const d = el('div', '', res);
            el('b', '', d).textContent = cap.known ? fmtShort(capFor(r, cap.max)) : '—';
            el('em', '', d).textContent = RES_NAME[r];
        });

        // ---- the factors, each one named ----
        el('div', 'ogxs_sec', body).textContent = T.sources;
        const src = (ok, label, value, link, linkLabel, at) =>
        {
            const d = el('div', 'ogxs_src' + (ok ? ' ogxs_ok' : ''), body);
            el('span', '', d).textContent = ok ? '●' : '○';
            const mid = el('span', '', d);
            mid.innerHTML = label + (value ? ': <b>' + value + '</b>' : '');
            if(!ok && link) { const a = el('a', '', d); a.href = link; a.textContent = linkLabel; }
            else if(!ok && linkLabel) el('span', '', d).textContent = linkLabel;
            else if(ok && at) el('span', 'ogxs_age', d).textContent = ago(at);
            return d;
        };
        const gameUrl = c => 'https://' + HOST + '/game/index.php?page=ingame&component=' + c;

        src(cfg.topScore > 0, T.topScore, cfg.topScore ? fmtInt(cfg.topScore) : '', gameUrl('highscore&category=1&type=0'), T.openRank, cfg.topScoreAt);
        src(true, T.step, fmtInt(cap.step.max) + (cap.step.topScore === Infinity ? ' (max)' : ' (≤ ' + fmtShort(cap.step.topScore) + ')'));
        src(cfg.isExplorer !== null, T.cls, cfg.isExplorer === null ? '' : (cfg.isExplorer ? T.explorer + ' (×3 ×' + cfg.speed + ')' : T.notExpl + ' (×2)'), '', T.unknownCls, cfg.classAt);
        src(cfg.speed > 0, T.speed, '×' + cfg.speed);
        src(cfg.lfAt > 0, T.lfBoost, fmtPct(cfg.lfBoost), '', T.openLf, cfg.lfAt);
        if(cfg.isExplorer) src(cfg.lfAt > 0, T.lfClass, fmtPct(cfg.lfClass), '', T.openLf, cfg.lfAt);
        const itemList = cfg.items || [];
        const itemsOn = itemList.filter(itemOn).length;
        src(cfg.itemsAt > 0, T.items, itemsOn + '/' + itemList.length + ' (×' + (Math.round(cap.itemBoost * 100) / 100) + ')', gameUrl('overview'), T.openOver, cfg.itemsAt);
        // Every item the buff bar showed, whether or not it was recognised — an amplifier this
        // script has never seen is listed here, unticked, instead of being silently dropped.
        itemList.forEach(it =>
        {
            const on = itemOn(it);
            const row = el('div', 'ogxs_item' + (on ? ' ogxs_on' : ''), body);
            row.title = it.u;
            el('span', 'ogxs_tick', row).textContent = on ? '\u2611' : '\u2610';
            el('span', 'ogxs_itemName', row).textContent = it.n || it.u.slice(0, 12) + '\u2026';
            el('b', '', row).textContent = '+' + fmtPct(it.p, 0);
            row.addEventListener('click', () =>
            {
                cfg.itemPick[it.u] = !on;
                saveCfg(); render();
            });
        });
        if(itemList.length && itemsOn < itemList.length) el('div', 'ogxs_note', body).textContent = T.itemHint;

        // ---- calibration from the reports themselves ----
        const g = gather(ui.scope === 'all' ? '7' : ui.scope, 'all');
        const cal = calibrate(g.rows);
        el('div', 'ogxs_sec', body).textContent = T.calib;
        const cd = el('div', 'ogxs_kv ogxs_strong', body);
        el('span', '', cd).textContent = cal.n + ' ' + T.finds;
        el('b', '', cd).textContent = cal.ok ? fmtShort(cal.lo) + ' – ' + (isFinite(cal.hi) ? fmtShort(cal.hi) : '∞') : '—';
        el('div', 'ogxs_note', body).textContent = T.calibTT;
        if(cal.ok && cap.known && (cap.max < cal.lo || cap.max > cal.hi))
        {
            el('div', 'ogxs_warn', body, '<b>' + fmtInt(cap.max) + '</b> ∉ [' + fmtInt(Math.round(cal.lo)) + ' , ' + fmtInt(Math.round(cal.hi)) + ']');
        }

        // ---- manual override ----
        const f = el('div', 'ogxs_field', body);
        const lab = el('label', '', f);
        lab.textContent = T.override;
        lab.title = T.overrideTT;
        const input = el('input', '', f);
        input.type = 'text';
        input.value = cfg.manualCap ? fmtInt(cfg.manualCap) : '';
        input.placeholder = cap.known && !cap.manual ? fmtInt(cap.max) : '0';
        const commit = () =>
        {
            const v = Math.max(0, int(input.value));
            if(v === cfg.manualCap) return;
            cfg.manualCap = v; saveCfg(); render();
        };
        input.addEventListener('change', commit);
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', ev => { if(ev.key === 'Enter') { ev.preventDefault(); commit(); } });

        const row = el('div', 'ogxs_btnRow', body);
        const rec = el('div', 'ogxs_btn', row);
        rec.textContent = T.recalc;
        rec.title = T.recalcTT;
        rec.addEventListener('click', () =>
        {
            const c = computeCap();
            if(!c.known) return;
            Object.keys(db.days).forEach(k => (db.days[k].f || []).forEach(f2 => { f2[3] = c.max; }));
            saveDb(); render();
        });

        const row2 = el('div', 'ogxs_btnRow', body);
        const exp = el('div', 'ogxs_btn', row2);
        exp.textContent = T.export;
        exp.title = T.exportTT;
        exp.addEventListener('click', exportJson);
        const rst = el('div', 'ogxs_btn', row2);
        rst.textContent = T.reset;
        rst.addEventListener('click', () =>
        {
            if(!confirm(T.resetAsk)) return;
            db = { v: 1, days: {} };
            // Deliberate erasure, so the merge above must not bring this universe back.
            const all = readRoll();
            if(all.uni) delete all.uni[UNI.key];
            writeRoll(all);
            saveDb(); render();
        });

        // What the archive holds and what it costs, since it is kept indefinitely.
        const dayKeys = sortedDays();
        const expes = dayKeys.reduce((n, k) => n + dayN(db.days[k]), 0);
        const finds = dayKeys.reduce((n, k) => n + (db.days[k].f || []).length, 0);
        let bytes = 0;
        try { bytes = (localStorage.getItem(LS.db) || '').length; } catch(e) {}

        el('div', 'ogxs_sec', body).textContent = T.archive;
        const kv2 = (k, v) => { const d = el('div', 'ogxs_kv', body); el('span', '', d).textContent = k; el('b', '', d).textContent = v; };
        kv2(T.keptDays, dayKeys.length + (dayKeys.length ? '  (' + prettyDay(dayKeys[0]) + ' \u2192 ' + prettyDay(dayKeys[dayKeys.length - 1]) + ')' : ''));
        kv2(T.expes, fmtInt(expes));
        kv2(T.finds, fmtInt(finds));
        kv2(T.size, bytes < 1024 ? bytes + ' B' : (Math.round(bytes / 102.4) / 10) + ' kB');
        el('div', 'ogxs_note', body).textContent = cfg.keepDays > 0
            ? T.keepFor + ' ' + cfg.keepDays + ' ' + (IT ? 'giorni' : 'days') + '.'
            : T.keepAll;
        if(storageProblem()) el('div', 'ogxs_warn', body, T.full);
    }

    // Writes a file to the player's own disk. Nothing is uploaded anywhere (§1.9).
    function exportJson()
    {
        try
        {
            const blob = new Blob([JSON.stringify({ db: db, cfg: cfg }, null, 1)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'ogame-expedition-stats-' + todayKey() + '.json';
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 2000);
        }
        catch(e) { console.error('[OGExpeditionStats] export failed:', e); }
    }

    function render()
    {
        if(!wrap) return;
        const todayCount = dayN(db.days[todayKey()]);

        tab.innerHTML = '';
        el('span', '', tab).textContent = T.title;
        if(todayCount) el('span', 'ogxs_tabBadge', tab).textContent = todayCount;
        tab.classList.toggle('ogxs_hidden', uiState === 'open');
        panel.classList.toggle('ogxs_hidden', uiState !== 'open');
        if(uiState !== 'open') { panel.innerHTML = ''; return; }

        panel.innerHTML = '';
        const head = el('div', 'ogxs_head', panel);
        el('div', 'ogxs_brand', head).textContent = T.title;
        const close = el('div', 'ogxs_icon', head);
        close.textContent = '✕';
        close.title = T.close;
        close.addEventListener('click', () => setState('closed'));

        const views = el('div', 'ogxs_views', panel);
        [['dist', T.vDist], ['days', T.vDays], ['uni', T.vUni], ['cap', T.vCap]].forEach(v =>
        {
            const n = el('div', 'ogxs_view' + (ui.view === v[0] ? ' ogxs_on' : ''), views);
            n.textContent = v[1];
            n.addEventListener('click', () => { ui.view = v[0]; saveUi(); render(); });
        });

        if(ui.view === 'dist' || ui.view === 'uni') renderFilters(panel, ui.view === 'uni');
        const body = el('div', 'ogxs_body', panel);

        if(ui.view === 'dist') renderDist(body);
        else if(ui.view === 'days') renderDays(body);
        else if(ui.view === 'uni') renderUnis(body);
        else renderCap(body);

        const foot = el('div', 'ogxs_foot', panel);
        el('span', '', foot).textContent = sortedDays().length + ' ' + T.keptDays;
        const a = el('a', '', foot);
        a.href = 'https://' + HOST + '/game/index.php?page=ingame&component=messages';
        a.textContent = T.title + ' →';
    }

    // --------------------------------------------------------------------- start
    // The panel lives outside the game's content so it survives the game's own re-renders; the
    // observer re-places it and picks up expedition reports when the PLAYER opens or pages
    // through the message folder. DOM-only observation — no server calls, no polling (§1.3/§4).
    let pending = false;
    function tick()
    {
        if(pending) return;
        pending = true;
        requestAnimationFrame(() =>
        {
            pending = false;
            try
            {
                build();
                place();
                const a = readSources();
                const b = ingestMessages();
                if(a || b || (uiState === 'open' && !panel.firstChild)) render();
            }
            catch(e) { console.error('[OGExpeditionStats] failed:', e); }
        });
    }

    function start()
    {
        try
        {
            build();
            if(cfgMigrated) { cfgMigrated = false; saveCfg(); }
            // Grooming runs on load: with nothing being deleted by age any more, the message ids
            // are the only part that would otherwise grow forever, and no new report is needed
            // to know that a day has aged past the dedupe window.
            if(dropOldDays() + dropOldIds()) saveDb();
            rollUp(); // whatever is already on record belongs in the comparison
            readSources();
            ingestMessages();
            render();
            // Our own panel is in the page too: a mutation inside it must never start another
            // pass, or rendering would feed itself.
            const observer = new MutationObserver(muts =>
            {
                for(let i = 0; i < muts.length; i++)
                {
                    if(wrap && wrap.contains(muts[i].target)) continue;
                    tick();
                    return;
                }
            });
            observer.observe(document.querySelector('#inhalt') || document.body, { childList: true, subtree: true });
        }
        catch(e) { console.error('[OGExpeditionStats] failed:', e); }
    }

    start();
})();
