// ==UserScript==
// @name         OGame Season Mission Tracker
// @namespace    https://github.com/nicolagalassi/progect
// @version      0.9.1
// @description  A collapsible panel beside the game menu listing the running season's achievements: tier ladder, progress and what each tier actually pays out (avatar, planet skin, title). Standalone companion to PrOGect.
// @author       nicolagalassi
// @match        https://*.ogame.gameforge.com/game/*
// @icon         https://gf1.geo.gfsrv.net/cdn3d/favicon.ico
// @run-at       document-idle
// @grant        none
// @license      MIT
// ==/UserScript==

/*
  OGame Season Mission Tracker — a small, self-contained userscript.

  THE PROBLEM IT SOLVES
  Seasonal universes hand out achievements (avatars, planet skins, titles) that are only
  reachable while the season runs. The list lives at Profile → Trofei, a long page you have
  to leave the game for, and it tells you what you must do far more loudly than what you
  get for doing it. This panel keeps the list one click away from any page, shows the prize
  as an actual picture, and lets you PIN the few you are working on.

  WHAT IT DOES
  - Adds a slim tab on the LEFT edge of the game's menu column. Clicking it opens a panel
    into the empty margin beside the game frame.
  - Each mission shows: the prize (skin/avatar thumbnail, engraved plate for a title), the
    requirement of the tier you are on, and a five-segment ladder — one segment per tier,
    filled for the ones you own, partially filled for the one in progress.
  - Open or closed, remembered across page loads; the ★ button on a mission pins it, and the
    ★ filter narrows the list down to what you pinned.
  - It is a VIEWER. It never claims a reward and never presses anything in the game.

  WHERE THE DATA COMES FROM
  The achievement view is server-rendered HTML inside the profile page, and the game itself
  exposes the endpoint that renders it (the page publishes it as `achievementsFetchUrl`):

      index.php?page=ingame&component=playerprofile&action=fetchAchievements&ajax=1&profileId=<id>

  Two paths, in this order:
  1. PASSIVE READ (default, zero server calls). When the player opens Profile → Trofei
     themselves, the script parses the DOM already on screen and caches it in localStorage.
  2. ONE-SHOT REFRESH, only on the player's explicit click on ⟳: a SINGLE request to the
     endpoint above, from any page. Never on a timer, never on page load.

  SEASONAL UNIVERSES ONLY
  The panel is meaningless where no season runs, so the first achievement view it reads
  decides: no season block → the verdict is stored (localStorage is per universe) and the
  panel removes itself from that universe, re-checking only if the player opens the
  achievement view again.

  COMPLIANCE (OGame Origin tool rules — see PrOGect/AGENTS.md):
  - §1.1  1 click = 1 action. The panel triggers no game action at all: it only reads and
          displays. Claiming/selecting a reward stays in the game's own screen.
  - §1.2  No scheduling. Nothing is queued or fired later.
  - §1.3/§4  No auto-refresh, no polling, no timers talking to the server. The default path
          is pure DOM reading of a page the player opened; the only background read happens
          on the explicit ⟳ click and is a single request (§4.1 — read once, never poll).
          The rotated ajax token is propagated so the game does not desync.
  - §4.2  No `cp=` anywhere: nothing here mutates session state.
  - §1.4  No alarms. The season countdown is a plain label computed from the expiry the page
          already carries; it notifies nothing and nobody.
  - §1.5  No alternative UI and no shortcut: this mirrors the achievement view read-only.
  - §1.6  Nothing here recreates a Dark Matter / Officer feature.
  - §1.7  CLOSED by default, anchored to the LEFT edge of the menu column (measured at
          runtime) and opening into the empty margin. It never hides, resizes, moves, covers
          or restyles the menu, the banners, the top ad bar, the footer, or Merchant /
          Officers / Shop. Reward thumbnails are the game's own CDN images, shown as-is.
  - §1.9  Nothing leaves the machine. All state (cache, pins, panel state) is localStorage.
  - §3    Comfort feature that mirrors an in-game view → GRAY AREA: get a ToolDev sign-off
          before publishing.
  - §5    Runs inside the OGame page → needs toleration before public distribution.
*/

(function()
{
    'use strict';

    const PAGE = window; // @grant none → shares the page window (achievementsFetchUrl, setNewTokenData).
    const HOST = window.location.host;
    const LS = {
        data:  'ogst_data',     // parsed season + achievements
        pins:  'ogst_pins',     // achievement ids the player pinned
        state: 'ogst_state',    // 'open' | 'mini' | 'closed'
        ui:    'ogst_ui',       // search / filter / per-section fold / expanded rows
        seas:  'ogst_seasonal', // '1' seasonal universe, '0' not seasonal → stay out of the way
    };
    // localStorage is per origin, so this verdict is per universe by construction.
    let seasonal = localStorage.getItem(LS.seas);

    // --------------------------------------------------------------------- styles
    // Design direction — "lit trophy case": the game's own blue-grey family, pushed darker and
    // cleaner for the ground, with an electric cyan accent doing all the structural work, so
    // the panel sits next to the game without borrowing its washed-out chrome.
    // Colour carries information in exactly one place, the prize type: gold = avatar,
    // violet = planet skin, mint = title, dim = achievement points only.
    const CSS = `
        .ogst_wrap{
            --ink:#0C131B; --panel:#131E28; --row:#1A2632; --row-hi:#22313F;
            --line:#2B3A4A; --line-hi:#3F5568;
            --acc:#48C8FF; --acc-hi:#B7ECFF; --acc-dim:#2C6E90;
            --cream:#E8F3FB; --mute:#8FA6B8; --faint:#5D7285;
            --gold:#FFC24D; --plum:#B98BFF; --mint:#3BE8B0;
            --disp:"Bahnschrift","DIN Alternate","Roboto Condensed","Arial Narrow",Impact,sans-serif;
            --body:"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
            --mono:ui-monospace,"JetBrains Mono","SF Mono",Consolas,monospace;
            position:fixed;z-index:9000;display:flex;flex-direction:row-reverse;align-items:flex-start;
            font-family:var(--body);
        }
        .ogst_wrap *{box-sizing:border-box}

        /* ---- the closed tab: a lit spine on the edge of the menu ---- */
        .ogst_tab{
            cursor:pointer;user-select:none;writing-mode:vertical-rl;text-orientation:mixed;
            padding:12px 5px;border:1px solid var(--acc-dim);border-right:none;border-radius:5px 0 0 5px;
            background:linear-gradient(180deg,#1B2A38,#0E161E);color:var(--acc);
            font-family:var(--disp);font-size:12px;font-weight:600;letter-spacing:1.4px;text-transform:uppercase;
            display:flex;align-items:center;gap:7px;box-shadow:-2px 2px 10px rgba(0,0,0,.55);
        }
        .ogst_tab:hover{border-color:var(--acc);color:var(--acc-hi);background:linear-gradient(180deg,#24384A,#121D26)}
        .ogst_tabBadge{
            writing-mode:horizontal-tb;background:var(--acc);color:#08111A;border-radius:7px;
            font-family:var(--mono);font-size:10px;font-weight:700;line-height:15px;padding:0 5px;
        }

        /* ---- the open panel ---- */
        .ogst_panel{
            width:352px;max-width:46vw;border:1px solid var(--line);border-right-color:var(--line-hi);
            border-radius:6px 0 0 6px;background:var(--ink);
            box-shadow:-4px 4px 18px rgba(0,0,0,.6);padding:0;display:flex;flex-direction:column;
        }
        .ogst_panel.ogst_hidden,.ogst_tab.ogst_hidden{display:none}

        .ogst_head{display:flex;align-items:center;gap:4px;padding:8px 9px 7px;border-bottom:1px solid var(--line)}
        .ogst_brand{
            flex:1 1 auto;min-width:0;font-family:var(--disp);font-size:14px;font-weight:600;letter-spacing:1.6px;
            text-transform:uppercase;color:var(--acc);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
        }
        .ogst_icon{
            cursor:pointer;color:var(--mute);font-size:13px;line-height:18px;width:22px;text-align:center;
            border:1px solid transparent;border-radius:3px;user-select:none;flex:0 0 auto;
        }
        .ogst_icon:hover{color:var(--acc-hi);border-color:var(--line-hi);background:var(--row)}
        .ogst_btn{
            cursor:pointer;user-select:none;flex:0 0 auto;display:inline-flex;align-items:center;gap:5px;
            padding:2px 9px;border:1px solid var(--acc-dim);border-radius:3px;background:var(--row);
            color:var(--acc);font-family:var(--disp);font-size:11px;letter-spacing:1px;text-transform:uppercase;
        }
        .ogst_btn:hover{border-color:var(--acc);color:var(--acc-hi);background:var(--row-hi)}
        .ogst_btn.ogst_busy{pointer-events:none;opacity:.7}
        .ogst_btn.ogst_busy span:first-child{display:inline-block;animation:ogst_spin .8s linear infinite}
        .ogst_icon.ogst_busy{animation:ogst_spin .8s linear infinite;color:var(--acc);pointer-events:none}
        @keyframes ogst_spin{to{transform:rotate(360deg)}}

        /* ---- season banner ---- */
        .ogst_season{padding:8px 9px;border-bottom:1px solid var(--line);background:linear-gradient(180deg,#16232E,var(--ink))}
        .ogst_sTop{display:flex;align-items:baseline;gap:8px}
        .ogst_sName{
            flex:1 1 auto;min-width:0;font-family:var(--disp);font-size:13px;letter-spacing:.8px;text-transform:uppercase;
            color:var(--cream);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
        }
        .ogst_sLeft{font-family:var(--mono);font-size:11px;color:var(--acc);white-space:nowrap}
        .ogst_sBar{height:4px;margin-top:6px;background:#0A121A;box-shadow:inset 0 0 0 1px rgba(0,0,0,.5);border-radius:2px;overflow:hidden}
        .ogst_sBar>i{display:block;height:100%;background:linear-gradient(90deg,var(--acc-dim),var(--acc))}
        .ogst_sFoot{display:flex;justify-content:space-between;margin-top:4px;font-size:10px;color:var(--faint)}
        .ogst_sFoot b{font-family:var(--mono);color:var(--mute);font-weight:400}

        /* ---- tools ---- */
        .ogst_tools{display:flex;gap:5px;align-items:center;padding:7px 9px 0}
        .ogst_tools input[type=text]{
            flex:1 1 auto;min-width:40px;padding:4px 8px;border-radius:3px;border:1px solid var(--line);
            background:#070E14 !important;color:var(--cream) !important;-webkit-text-fill-color:var(--cream);
            caret-color:var(--acc);font-family:var(--body);font-size:11px;
        }
        .ogst_tools input[type=text]:focus{outline:none;border-color:var(--acc-dim)}
        .ogst_tools input::placeholder{color:var(--faint)}
        .ogst_chips{display:flex;gap:4px;padding:6px 9px 7px}
        .ogst_chip{
            cursor:pointer;user-select:none;font-family:var(--disp);font-size:11px;letter-spacing:.8px;
            text-transform:uppercase;line-height:17px;padding:0 9px;border-radius:3px;
            border:1px solid var(--line);color:var(--mute);white-space:nowrap;
        }
        .ogst_chip:hover{border-color:var(--line-hi);color:var(--cream)}
        .ogst_chip.ogst_on{border-color:var(--acc-dim);color:var(--acc);background:rgba(72,200,255,.14)}

        /* ---- sections ---- */
        .ogst_scroll{overflow-y:auto;max-height:52vh;padding:0 9px 8px}
        .ogst_scroll::-webkit-scrollbar{width:8px}
        .ogst_scroll::-webkit-scrollbar-thumb{background:#2B3A4A;border-radius:4px}
        .ogst_secHead{
            display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none;margin:9px 0 5px;
            font-family:var(--disp);font-size:10px;letter-spacing:1.4px;text-transform:uppercase;color:var(--faint);
        }
        .ogst_secHead:hover{color:var(--mute)}
        .ogst_secHead::after{content:"";flex:1 1 auto;height:1px;background:var(--line)}
        .ogst_secHead .ogst_caret{display:inline-block;transition:transform .12s ease}
        .ogst_secHead.ogst_folded .ogst_caret{transform:rotate(-90deg)}
        .ogst_list{display:flex;flex-direction:column;gap:6px}
        .ogst_list.ogst_hidden{display:none}

        /* ---- mission card ---- */
        .ogst_card{border:1px solid var(--line);border-radius:4px;background:var(--row);overflow:hidden}
        .ogst_card:hover{border-color:var(--line-hi);background:var(--row-hi)}
        .ogst_card.ogst_pinned{border-color:var(--acc-dim);box-shadow:inset 2px 0 0 var(--acc)}
        .ogst_card.ogst_done{opacity:.72}
        .ogst_card.ogst_done:hover{opacity:1}
        .ogst_top{display:flex;gap:8px;padding:7px 8px}

        /* the prize case — the one loud element */
        .ogst_vault{
            flex:0 0 46px;width:46px;height:46px;border-radius:3px;border:1px solid var(--line-hi);
            background:#070E14 center/cover no-repeat;display:flex;align-items:center;justify-content:center;
            overflow:hidden;position:relative;
        }
        .ogst_vault img{width:100%;height:100%;object-fit:cover;display:block}
        .ogst_vault[data-kind=skin]{border-color:#6E4FA8;box-shadow:inset 0 0 14px rgba(185,139,255,.3)}
        .ogst_vault[data-kind=avatar]{border-color:#9B7527;box-shadow:inset 0 0 14px rgba(255,194,77,.28)}
        .ogst_vault[data-kind=title]{border-color:#237A5E;box-shadow:inset 0 0 14px rgba(59,232,176,.22)}
        .ogst_vault[data-kind=points]{border-color:var(--line);color:var(--faint)}
        .ogst_plate{
            font-family:var(--disp);font-size:7.5px;line-height:1.2;letter-spacing:.2px;text-transform:uppercase;
            color:var(--mint);text-align:center;padding:2px;width:100%;word-break:break-word;hyphens:auto;
            display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;
        }
        .ogst_glyph{font-size:17px;color:var(--faint);line-height:1}
        .ogst_glyph[data-kind=title]{color:var(--mint)}
        .ogst_glyph[data-kind=skin]{color:var(--plum)}
        .ogst_glyph[data-kind=avatar]{color:var(--gold)}

        .ogst_main{flex:1 1 auto;min-width:0}
        .ogst_name{display:flex;gap:6px;align-items:baseline;font-family:var(--disp);font-size:13px;
            letter-spacing:.4px;color:var(--cream);line-height:1.2;word-break:break-word;margin:0}
        .ogst_num{flex:0 0 auto;font-family:var(--mono);font-size:10px;color:var(--acc-dim)}
        .ogst_card.ogst_done .ogst_name{color:var(--acc-hi)}
        .ogst_goal{font-size:10.5px;color:var(--mute);line-height:1.35;margin:3px 0 0;word-break:break-word}

        /* the tier ladder: one segment per tier, the real structure of an achievement.
           Above it sits every prize the mission pays, each one parked over the tier that
           hands it over — an achievement can pay two or three, and rarely at the last tier. */
        .ogst_marks{display:flex;gap:2px;margin-top:6px;min-height:20px;align-items:flex-end}
        .ogst_marks>i{flex:1 1 0;display:flex;justify-content:center;align-items:flex-end}
        .ogst_marks>i.ogst_mPast{opacity:.42}
        .ogst_mCase{
            flex:0 0 20px;width:20px;height:20px;border-radius:2px;border:1px solid var(--line-hi);
            background:#070E14 center/cover no-repeat;overflow:hidden;display:flex;align-items:center;justify-content:center;
        }
        .ogst_mCase img{width:100%;height:100%;object-fit:cover;display:block}
        .ogst_mCase[data-kind=skin]{border-color:#6E4FA8}
        .ogst_mCase[data-kind=avatar]{border-color:#9B7527}
        .ogst_mCase[data-kind=title]{border-color:#237A5E}
        .ogst_mCase.ogst_mNext{box-shadow:0 0 0 1px var(--acc),0 0 8px rgba(72,200,255,.45)}
        .ogst_mCase .ogst_glyph{font-size:11px}
        .ogst_ladder{display:flex;gap:2px;margin-top:1px}
        .ogst_ladder>i{flex:1 1 0;height:7px;border-radius:1px;background:#0A121A;box-shadow:inset 0 0 0 1px rgba(0,0,0,.5);position:relative;overflow:hidden}
        .ogst_ladder>i.ogst_lOn{background:linear-gradient(180deg,var(--acc-hi),var(--acc-dim))}
        .ogst_ladder>i.ogst_lNow::after{
            content:"";position:absolute;left:0;top:0;bottom:0;width:var(--p,0%);
            background:linear-gradient(180deg,var(--acc-hi),var(--acc));
        }
        .ogst_card.ogst_done .ogst_ladder>i.ogst_lOn{background:linear-gradient(180deg,#B7ECFF,#2C6E90)}

        .ogst_meta{display:flex;align-items:center;gap:7px;margin-top:5px;font-size:10px;color:var(--faint);flex-wrap:wrap}
        .ogst_grade{font-family:var(--disp);letter-spacing:.9px;text-transform:uppercase;color:var(--mute)}
        .ogst_count{
            font-family:var(--mono);font-size:10px;color:var(--acc);background:rgba(72,200,255,.12);
            border:1px solid var(--acc-dim);border-radius:3px;padding:0 5px;line-height:15px;
        }
        .ogst_prize{
            display:inline-block;margin-left:auto;min-width:0;max-width:100%;
            font-family:var(--disp);font-size:10px;letter-spacing:.9px;text-transform:uppercase;
            white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
        }
        .ogst_prize[data-kind=skin]{color:var(--plum)}
        .ogst_prize[data-kind=avatar]{color:var(--gold)}
        .ogst_prize[data-kind=title]{color:var(--mint)}
        .ogst_prize[data-kind=points]{color:var(--faint)}

        .ogst_pin{
            flex:0 0 auto;cursor:pointer;user-select:none;align-self:flex-start;
            width:20px;height:20px;line-height:19px;text-align:center;font-size:15px;border-radius:3px;
            border:1px solid var(--line);color:#7C93A6;background:rgba(255,255,255,.02);
        }
        .ogst_pin:hover{color:var(--acc-hi);border-color:var(--acc-dim);background:var(--row-hi)}
        .ogst_pin.ogst_on{color:var(--gold);border-color:#9B7527;background:rgba(255,194,77,.12);text-shadow:0 0 8px rgba(255,194,77,.5)}

        .ogst_more{
            cursor:pointer;user-select:none;display:block;padding:4px 8px 6px;font-family:var(--disp);
            font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--faint);
        }
        .ogst_more:hover{color:var(--acc)}

        /* ---- expanded tier ladder ---- */
        .ogst_tiers{border-top:1px solid var(--line);background:#111A23;padding:5px 8px 7px}
        .ogst_tiers.ogst_hidden{display:none}
        .ogst_tier{display:flex;gap:7px;align-items:flex-start;padding:4px 0;font-size:10px;color:var(--mute);line-height:1.35}
        .ogst_tier+.ogst_tier{border-top:1px solid rgba(59,44,31,.6)}
        .ogst_tStep{
            flex:0 0 18px;width:18px;height:18px;border-radius:2px;border:1px solid var(--line-hi);
            font-family:var(--mono);font-size:10px;line-height:16px;text-align:center;color:var(--faint);background:#182430;
        }
        .ogst_tier.ogst_tDone .ogst_tStep{border-color:var(--acc-dim);color:var(--acc);background:#1B2C3A}
        .ogst_tier.ogst_tNow .ogst_tStep{border-color:var(--acc);color:#08111A;background:var(--acc);font-weight:700}
        .ogst_tCase{flex:0 0 22px;width:22px;height:22px;border-radius:2px;border:1px solid var(--line-hi);
            background:#070E14 center/cover no-repeat;overflow:hidden;display:flex;align-items:center;justify-content:center}
        .ogst_tCase img{width:100%;height:100%;object-fit:cover;display:block}
        .ogst_tCase[data-kind=skin]{border-color:#6E4FA8}
        .ogst_tCase[data-kind=avatar]{border-color:#9B7527}
        .ogst_tCase[data-kind=title]{border-color:#237A5E}
        .ogst_tCase .ogst_glyph{font-size:11px}
        .ogst_tBody{flex:1 1 auto;min-width:0;word-break:break-word}
        .ogst_tier.ogst_tNow .ogst_tBody{color:var(--cream)}
        .ogst_tPrize{display:block;margin-top:2px;font-family:var(--disp);font-size:9.5px;letter-spacing:.8px;text-transform:uppercase}
        .ogst_tPrize[data-kind=skin]{color:var(--plum)}
        .ogst_tPrize[data-kind=avatar]{color:var(--gold)}
        .ogst_tPrize[data-kind=title]{color:var(--mint)}
        .ogst_tVal{flex:0 0 auto;font-family:var(--mono);font-size:10px;color:var(--mute);white-space:nowrap;line-height:15px}
        .ogst_tier.ogst_tDone .ogst_tVal{color:var(--acc-hi)}
        .ogst_tier.ogst_tNow .ogst_tVal{
            color:var(--acc);background:rgba(72,200,255,.12);border:1px solid var(--acc-dim);
            border-radius:3px;padding:0 5px;
        }
        /* how far each unfinished tier actually is — the thing the game buries */
        .ogst_tBar{height:4px;margin-top:4px;background:#0A121A;box-shadow:inset 0 0 0 1px rgba(0,0,0,.5);border-radius:2px;overflow:hidden}
        .ogst_tBar>i{display:block;height:100%;background:#3E8FB4;min-width:2px}
        .ogst_tier.ogst_tNow .ogst_tBar>i{background:linear-gradient(90deg,var(--acc-hi),var(--acc))}

        /* ---- empty / footer ---- */
        .ogst_empty{padding:16px 10px;text-align:center;font-size:11px;color:var(--mute);line-height:1.55}
        .ogst_empty b{color:var(--cream);font-weight:600}
        .ogst_load{
            cursor:pointer;user-select:none;display:block;width:fit-content;margin:0 auto 8px;padding:6px 16px;
            border-radius:3px;border:1px solid var(--acc-dim);background:linear-gradient(180deg,#1B2C3A,#111A23);
            color:var(--acc);font-family:var(--disp);font-size:12px;letter-spacing:1.2px;text-transform:uppercase;
        }
        .ogst_load:hover{border-color:var(--acc);color:var(--acc-hi)}
        .ogst_load.ogst_busy{animation:ogst_spin .8s linear infinite;pointer-events:none}
        .ogst_foot{
            display:flex;justify-content:space-between;gap:8px;padding:6px 9px;border-top:1px solid var(--line);
            font-size:9.5px;color:var(--faint);
        }
        .ogst_foot span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .ogst_foot a{color:var(--faint);text-decoration:none;border-bottom:1px dotted var(--line-hi)}
        .ogst_foot a:hover{color:var(--acc)}

        /* prize preview — 46px is enough to recognise a skin, not to enjoy it */
        .ogst_peek{
            position:fixed;z-index:9001;display:none;padding:7px;border:1px solid var(--line-hi);
            border-radius:5px;background:var(--panel);box-shadow:0 10px 30px rgba(0,0,0,.7);pointer-events:none;
        }
        .ogst_peek.ogst_on{display:block}
        .ogst_peek[data-kind=skin]{border-color:#6E4FA8}
        .ogst_peek[data-kind=avatar]{border-color:#9B7527}
        .ogst_peek[data-kind=title]{border-color:#237A5E}
        .ogst_peek img{display:block;width:176px;height:176px;object-fit:contain;background:#070E14;border-radius:3px}
        .ogst_peekPlate{
            width:176px;min-height:92px;display:flex;align-items:center;justify-content:center;padding:12px;
            background:#070E14;border-radius:3px;font-family:var(--disp);font-size:16px;line-height:1.25;
            letter-spacing:1px;text-transform:uppercase;color:var(--mint);text-align:center;word-break:break-word;
        }
        .ogst_peekCap{
            margin-top:6px;max-width:176px;font-family:var(--disp);font-size:10px;letter-spacing:1.1px;
            text-transform:uppercase;text-align:center;color:var(--mute);
        }
        @media (prefers-reduced-motion:reduce){ .ogst_wrap *{transition:none !important;animation:none !important} }
    `;

    function injectStyle()
    {
        if(document.getElementById('ogst_style')) return;
        const s = document.createElement('style');
        s.id = 'ogst_style';
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
    // OGame prints "1.000.000" (it) / "1,000,000" (en) — strip the thousands separators only.
    const num = v =>
    {
        const s = String(v == null ? '' : v).replace(/[^\d.,]/g, '');
        if(!s) return 0;
        const n = parseFloat(s.replace(/[.,](?=\d{3}(\D|$))/g, '').replace(',', '.'));
        return isFinite(n) ? n : 0;
    };
    const fmt = n =>
    {
        n = Math.round(n || 0);
        if(n >= 1e9) return (n / 1e9).toFixed(n >= 1e10 ? 0 : 1) + 'G';
        if(n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M';
        if(n >= 1e4) return Math.round(n / 1e3) + 'k';
        return String(n);
    };
    const pad2 = n => (n < 10 ? '0' : '') + n;

    // Labels. Small it/en dictionary picked from the page language; the achievement texts
    // themselves are already localized by the game and are shown verbatim.
    const IT = (document.documentElement.lang || PAGE.userLang || '').toLowerCase().indexOf('it') === 0;
    const T = {
        title:    IT ? 'Stagione' : 'Season',
        search:   IT ? 'cerca…' : 'search…',
        all:      IT ? 'Tutte' : 'All',
        todo:     IT ? 'Da fare' : 'To do',
        done:     IT ? 'Fatte' : 'Done',
        pinned:   IT ? 'Fissate' : 'Pinned',
        list:     IT ? 'Missioni' : 'Missions',
        refresh:  IT ? 'Aggiorna: una sola lettura, solo su questo click' : 'Refresh: a single read, only on this click',
        close:    IT ? 'Chiudi' : 'Close',
        openGame: IT ? 'Vai ai Trofei' : 'Open Trophies',
        grade:    IT ? 'Grado' : 'Tier',
        gradeOf:  IT ? 'di' : 'of',
        gradeShort: IT ? 'G' : 'T',
        onlyPins: IT ? 'Fissate' : 'Pinned',
        reload:   IT ? 'Aggiorna' : 'Refresh',
        ladder:   IT ? 'Tutti i gradi' : 'All tiers',
        hide:     IT ? 'Nascondi gradi' : 'Hide tiers',
        unlocked: IT ? 'Sbloccato' : 'Unlocked',
        points:   IT ? 'Punti' : 'Points',
        noPins:   IT ? 'Fissa una missione con la ★ per tenerla qui.' : 'Pin a mission with ★ to keep it here.',
        noData:   IT ? 'Il pannello è vuoto.<br>Una sola lettura e si popola: <b>non serve aprire i Trofei</b>.'
                     : 'The panel is empty.<br>One single read fills it: <b>no need to open Trophies</b>.',
        loadNow:  IT ? 'Carica' : 'Load',
        noMatch:  IT ? 'Nessuna missione con questo filtro.' : 'No mission matches this filter.',
        read:     IT ? 'letto' : 'read',
        never:    IT ? 'mai' : 'never',
        left:     IT ? 'alla fine' : 'to go',
        ended:    IT ? 'conclusa' : 'ended',
        failed:   IT ? 'Lettura non riuscita. Riprova, o apri i Trofei nel gioco.' : 'Read failed. Retry, or open Trophies in game.',
    };

    // --------------------------------------------------------------------- storage
    const readJSON = (k, fb) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? fb : v; } catch(e) { return fb; } };
    const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch(e) {} };

    let store = readJSON(LS.data, null);  // { at, season:{...}, items:[...] }
    let pins  = readJSON(LS.pins, []);
    let ui    = readJSON(LS.ui, { q: '', filter: 'todo', foldPins: false, foldList: false, open: {} });
    let uiState = localStorage.getItem(LS.state) || 'closed'; // closed by default → covers nothing (§1.7)
    // 'mini' used to be a separate state behind an unlabelled icon; it is now the ★ filter,
    // which says what it does. Anyone carrying the old state lands on the equivalent view.
    if(uiState === 'mini') { uiState = 'open'; ui.filter = 'pinned'; }

    const isPinned = id => pins.indexOf(id) >= 0;
    function togglePin(id)
    {
        const i = pins.indexOf(id);
        if(i >= 0) pins.splice(i, 1); else pins.push(id);
        writeJSON(LS.pins, pins);
    }

    // --------------------------------------------------------------------- parser
    // Reads the achievement markup the game renders (identical whether it comes from the
    // open profile page or from the fetchAchievements endpoint). Pure string/DOM work.
    //
    // Structure (OGame v13):
    //   #achievementsOverviewCategories .achievementCategory[data-achievement-category-id=seasonNN].active
    //   #achievementContentList_seasonNN[data-expiry-timestamp]
    //     .achievementOverviewAchievementHolder#achievementOverviewAchievementHolder_<id>
    //       .achievementOverviewAchievementTitle span  → "#1 - Voglia di ricerca"
    //       .achievementTierContainer.tier_N[.unlocked][.visible]
    //         .description                                → requirement text
    //         .unlockedContainer                          → "Sbloccato : 21.08.2026 14:12"
    //         progress.achievementProgress[value][max]    → fraction
    //         .achievementProgressLabel                   → "2 / 7" (target inside .progressTarget)
    //         .achievementReward → <space-object-skin><img>   planet skin (real image)
    //                            → <profile-picture class=ID> avatar (image lives on the CDN)
    //                            → .rewardTypeTitle           title (its own name)
    //                            → empty                      achievement points only
    //   .seasonalSummary (per season) → the one flagged `.running` gives name and X/75.

    // What a tier pays out. Detected by TAG, not by the localized label, so it works in any
    // language; the label is kept only for display.
    function parseReward(node)
    {
        const box = node.querySelector('.achievementReward');
        if(!box) return null;
        const label = txt(box.querySelector('.rewardDescription'));
        const skin = box.querySelector('space-object-skin');
        if(skin)
        {
            const img = skin.querySelector('img');
            return { kind: 'skin', label: label || 'Skin',
                     name: (img && img.getAttribute('alt')) || '',
                     img: (img && img.getAttribute('src')) || '' };
        }
        const ava = box.querySelector('profile-picture');
        if(ava)
        {
            const img = ava.querySelector('img');
            const id = (ava.className || '').trim().split(/\s+/)[0];
            return { kind: 'avatar', label: label || 'Avatar', name: id,
                     // Unlocked avatars come with an <img>; locked ones are CSS-only, so we
                     // point at the same CDN path the game uses in its own avatar gallery.
                     img: (img && img.getAttribute('src')) ||
                          (id && /^[A-Za-z0-9_]+$/.test(id) ? `https://${HOST}/cdn/img/avatars/avatar/basic/${id}.jpg` : '') };
        }
        const title = box.querySelector('.rewardTypeTitle');
        if(title) return { kind: 'title', label: label || 'Titolo', name: txt(title), img: '' };
        return null;
    }

    function parseTier(node)
    {
        const cls = node.className || '';
        const tier = (cls.match(/tier_(\d+)/) || [])[1];
        const done = /\bunlocked\b/.test(cls);
        const bar = node.querySelector('progress.achievementProgress');
        const label = node.querySelector('.achievementProgressLabel');
        let current = 0, target = 0;
        if(label)
        {
            target = num(txt(label.querySelector('.progressTarget')));
            current = num(txt(label).split('/')[0]);
        }
        const frac = bar ? (parseFloat(bar.getAttribute('value')) || 0) / (parseFloat(bar.getAttribute('max')) || 1) : (done ? 1 : 0);
        return {
            tier:    parseInt(tier || '0', 10),
            desc:    txt(node.querySelector('.description')),
            done:    done,
            current: current,
            target:  target,
            pct:     done ? 100 : Math.max(0, Math.min(100, Math.round(frac * 100))),
            at:      txt(node.querySelector('.unlockedContainer')).replace(/^\D*[:：]\s*/, ''),
            reward:  parseReward(node),
        };
    }

    function parseHolder(node)
    {
        const id = (node.id || '').replace('achievementOverviewAchievementHolder_', '');
        const raw = txt(node.querySelector('.achievementOverviewAchievementTitle span')) ||
                    txt(node.querySelector('.achievementOverviewAchievementTitle'));
        if(!id || !raw) return null;
        const m = raw.match(/^#(\d+)\s*-\s*(.*)$/);
        const tiers = Array.from(node.querySelectorAll('.achievementTierContainer')).map(parseTier)
                           .filter(t => t.tier || t.desc)
                           .sort((a, b) => a.tier - b.tier);
        if(!tiers.length) return null;
        const doneCount = tiers.filter(t => t.done).length;
        return {
            id:      id,
            num:     m ? parseInt(m[1], 10) : 0,
            name:    m ? m[2].trim() : raw,
            tiers:   tiers,
            doneAll: doneCount === tiers.length,
            doneCnt: doneCount,
        };
    }

    // The running season block: the category flagged `active` names it, its content list
    // carries the expiry. Falls back to whatever seasonNN content list is present.
    function parseSeason(root)
    {
        const cat = root.querySelector('#achievementsOverviewCategories .achievementCategory.active[data-achievement-category-id^="season"]') ||
                    root.querySelector('#achievementsOverviewCategories .achievementCategory[data-achievement-category-id^="season"]');
        const key = cat && cat.getAttribute('data-achievement-category-id');
        const list = (key && root.querySelector('#achievementContentList_' + key)) ||
                     root.querySelector('[id^="achievementContentList_season"]');
        if(!list) return null;

        let name = txt(cat), doneCnt = 0, total = 0;
        const running = Array.from(root.querySelectorAll('.seasonalSummary'))
                             .find(s => s.querySelector('.seasonalSummarySeasonStatus .running'));
        if(running)
        {
            name = txt(running.querySelector('.seasonalSummaryTitle')) || name;
            const mm = txt(running.querySelector('.seasonalSummaryHeaderTitleAndProgress > div:last-child'))
                       .match(/(\d[\d.,]*)\s*\/\s*(\d[\d.,]*)/);
            if(mm) { doneCnt = num(mm[1]); total = num(mm[2]); }
        }
        const expiry = parseInt(list.getAttribute('data-expiry-timestamp') || '0', 10); // seconds left when rendered
        return {
            key: key || '', name: name || 'Season', doneCnt: doneCnt, total: total,
            endsAt: expiry > 0 ? Date.now() + expiry * 1000 : 0,
            list: list,
        };
    }

    function parse(root)
    {
        const season = parseSeason(root);
        if(!season) return null;
        const items = Array.from(season.list.querySelectorAll('.achievementOverviewAchievementHolder'))
                           .filter(n => !/\bhidden\b/.test(n.className))
                           .map(parseHolder)
                           .filter(Boolean)
                           .sort((a, b) => a.num - b.num);
        if(!items.length) return null;
        return {
            at: Date.now(),
            season: { key: season.key, name: season.name, doneCnt: season.doneCnt, total: season.total, endsAt: season.endsAt },
            items: items,
        };
    }

    function ingest(parsed, source)
    {
        if(!parsed) return false;
        parsed.source = source;
        store = parsed;
        writeJSON(LS.data, store);
        return true;
    }

    // --------------------------------------------------------------------- seasonal gate
    // The panel only makes sense on a seasonal universe. A complete achievement view that
    // carries NO season block is the game telling us this universe has none: we record that
    // and take the panel off the page entirely, so nothing is added where it is useless.
    let observer = null;
    function setSeasonal(on)
    {
        const v = on ? '1' : '0';
        if(seasonal !== v) { seasonal = v; try { localStorage.setItem(LS.seas, v); } catch(e) {} }
        if(!on) teardown();
    }
    function teardown()
    {
        try { if(observer) observer.disconnect(); } catch(e) {}
        observer = null;
        if(wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap);
        wrap = panel = tab = peek = null;
        try { localStorage.removeItem(LS.data); } catch(e) {}
        console.info('[OGSeasonTracker] no season on this universe → panel disabled here ' +
                     '(it re-checks by itself if you open the achievement view again).');
    }

    // Single entry point for both read paths: parse, and decide the seasonal verdict.
    function consume(root, source)
    {
        const parsed = parse(root);
        if(parsed) { setSeasonal(true); return ingest(parsed, source); }
        if(root.querySelector('#achievementsOverviewCategories')) setSeasonal(false);
        return false;
    }

    // --------------------------------------------------------------------- refresh (user click only)
    // The game publishes the exact endpoint that renders the achievement list; when we are
    // not on the profile page we rebuild it from the player id. ONE request, on click only
    // (§1.3/§4.1 — never on a timer, never on page load). No `cp=` (§4.2).
    function fetchUrl()
    {
        if(typeof PAGE.achievementsFetchUrl === 'string' && PAGE.achievementsFetchUrl) return PAGE.achievementsFetchUrl;
        const meta = document.querySelector('meta[name="ogame-player-id"]');
        const pid = (meta && meta.content) || PAGE.playerId || '';
        if(!pid) return '';
        return `https://${HOST}/game/index.php?page=ingame&component=playerprofile&action=fetchAchievements&ajax=1&profileId=${encodeURIComponent(pid)}`;
    }

    async function refresh(btn)
    {
        if(btn && btn.classList.contains('ogst_busy')) return;
        if(btn) btn.classList.add('ogst_busy');
        try
        {
            // Free first: if the achievement view is already on screen, no request at all.
            if(ingestFromPage()) { render(); return; }
            if(!wrap) return; // verdict came back "not seasonal": nothing left to refresh

            const url = fetchUrl();
            if(!url) { console.warn('[OGSeasonTracker] no player id on this page; open Profile → Trofei once.'); return; }
            const res = await fetch(url, { credentials: 'include', cache: 'no-cache', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
            const body = await res.text();

            let html = body;
            if(/^\s*[{[]/.test(body))
            {
                let json = null;
                try { json = JSON.parse(body); } catch(e) { json = null; }
                if(json)
                {
                    // Propagate the rotated ajax token so the game's own requests stay in sync.
                    if(json.newAjaxToken && typeof PAGE.setNewTokenData === 'function') { try { PAGE.setNewTokenData(json.newAjaxToken); } catch(e) {} }
                    html = typeof json.content === 'string' ? json.content
                         : (json.content && typeof json.content === 'object'
                            ? Object.values(json.content).filter(v => typeof v === 'string').join('')
                            : (json.html || json.target || ''));
                }
            }
            const box = document.createElement('div');
            box.innerHTML = html;
            if(!consume(box, 'fetch')) console.warn('[OGSeasonTracker] ' + T.failed);
            render();
        }
        catch(e) { console.error('[OGSeasonTracker] refresh failed:', e); }
        finally { if(btn) btn.classList.remove('ogst_busy'); }
    }

    // Passive read of the page the player has open (Profile → Trofei). No traffic.
    let lastSig = '';
    function ingestFromPage()
    {
        if(!document.getElementById('achievementsOverviewCategories')) return false;
        const sig = document.querySelectorAll('.achievementOverviewAchievementHolder').length + '|' +
                    (document.querySelector('[id^="achievementContentList_season"]') || {}).id;
        if(sig === lastSig) return false;
        lastSig = sig;
        return consume(document, 'dom');
    }

    // --------------------------------------------------------------------- UI
    let wrap = null, panel = null, tab = null, peek = null;

    // Enlarged look at a prize while the pointer rests on its case. It opens into the free
    // margin on the left and only falls back over our own panel — never over the game's
    // content, banners or menu (§1.7) — and it disappears with the pointer.
    function showPeek(anchor, reward)
    {
        if(!peek || !reward) return;
        peek.innerHTML = '';
        peek.setAttribute('data-kind', reward.kind);
        if(reward.img)
        {
            const img = el('img', '', peek);
            img.src = reward.img;
            img.alt = reward.label;
            img.addEventListener('error', () => hidePeek());
        }
        else if(reward.kind === 'title') el('div', 'ogst_peekPlate', peek).textContent = reward.name;
        else return;
        el('div', 'ogst_peekCap', peek).textContent =
            reward.label + (reward.kind === 'title' && reward.name ? ' · ' + reward.name : '');

        peek.classList.add('ogst_on');
        const a = anchor.getBoundingClientRect();
        const p = peek.getBoundingClientRect();
        const panelLeft = panel ? panel.getBoundingClientRect().left : a.left;
        let left = panelLeft - p.width - 8;
        if(left < 4) left = Math.min(panelLeft + 6, window.innerWidth - p.width - 4);
        peek.style.left = Math.max(4, left) + 'px';
        peek.style.top = Math.max(4, Math.min(a.top + a.height / 2 - p.height / 2, window.innerHeight - p.height - 4)) + 'px';
    }
    function hidePeek() { if(peek) { peek.classList.remove('ogst_on'); peek.innerHTML = ''; } }

    function setState(s)
    {
        uiState = s;
        localStorage.setItem(LS.state, s);
        render();
    }
    const saveUi = () => writeJSON(LS.ui, ui);

    // The tier the player is on: first not-unlocked one, else the last.
    const activeTier = it => it.tiers.find(t => !t.done) || it.tiers[it.tiers.length - 1];
    // The prize you are actually heading for. Prizes are not spread evenly: an achievement
    // can have five tiers and pay the skin at tier 4, so we look for the first tier you have
    // NOT taken yet that carries one, and remember which tier that is. Everything claimed
    // already → the last prize of the ladder.
    function nextPrize(it)
    {
        const open = it.tiers.find(t => !t.done && t.reward);
        if(open) return { reward: open.reward, tier: open.tier };
        const last = it.tiers.slice().reverse().find(t => t.reward);
        return last ? { reward: last.reward, tier: last.tier } : null;
    }

    function visibleItems()
    {
        const q = (ui.q || '').toLowerCase().trim();
        return ((store && store.items) || []).filter(it =>
        {
            if(ui.filter === 'todo' && it.doneAll) return false;
            if(ui.filter === 'done' && !it.doneAll) return false;
            if(ui.filter === 'pinned' && !isPinned(it.id)) return false;
            if(q)
            {
                const hay = (it.name + ' ' + it.tiers.map(t => t.desc + ' ' + (t.reward ? t.reward.label + ' ' + t.reward.name : '')).join(' ')).toLowerCase();
                if(hay.indexOf(q) < 0) return false;
            }
            return true;
        }).sort((a, b) =>
        {
            if(a.doneAll !== b.doneAll) return a.doneAll ? 1 : -1;   // open ones first
            const pa = activeTier(a).pct, pb = activeTier(b).pct;
            if(pa !== pb) return pb - pa;                            // closest to completion first
            return a.num - b.num;
        });
    }

    // The prize case. Shows the game's own artwork where there is one, an engraved plate for
    // a title, and a plain mark when the tier only pays achievement points.
    function vault(parent, reward, size)
    {
        const kind = reward ? reward.kind : 'points';
        const v = el('div', 'ogst_vault', parent);
        v.setAttribute('data-kind', kind);
        if(size) { v.style.flexBasis = size + 'px'; v.style.width = size + 'px'; v.style.height = size + 'px'; }
        if(reward && reward.img)
        {
            const img = el('img', '', v);
            img.src = reward.img;
            img.alt = reward.name || reward.label;
            img.loading = 'lazy';
            img.addEventListener('error', () => { img.remove(); el('div', 'ogst_glyph', v, kind === 'avatar' ? '☺' : '◍'); });
        }
        else if(kind === 'title')
        {
            // The full title fits on the big plate; at thumbnail size it turns into unreadable
            // 6px lettering, so a mark stands in for it and the name is read from the row.
            if(size && size < 30) el('div', 'ogst_glyph', v, '✦').setAttribute('data-kind', 'title');
            else el('div', 'ogst_plate', v).textContent = reward.name;
        }
        else el('div', 'ogst_glyph', v, '◆');
        v.title = reward ? (reward.label + (kind === 'title' && reward.name ? ': ' + reward.name : '')) : T.points;
        return v;
    }

    function card(it, parent)
    {
        const cur = activeTier(it);
        const prize = nextPrize(it);
        const c = el('article', 'ogst_card' + (it.doneAll ? ' ogst_done' : '') + (isPinned(it.id) ? ' ogst_pinned' : ''), parent);
        const top = el('div', 'ogst_top', c);

        vault(top, prize && prize.reward);

        const main = el('div', 'ogst_main', top);
        const name = el('h3', 'ogst_name', main);
        el('span', 'ogst_num', name).textContent = pad2(it.num);
        el('span', '', name).textContent = it.name;
        if(cur.desc) el('p', 'ogst_goal', main).textContent = cur.desc;

        // Every prize of the mission, each one sitting over the tier that pays it. Claimed
        // ones fade back; the next one you can reach is ringed in the accent colour.
        const marks = it.tiers.some(t => t.reward) ? el('div', 'ogst_marks', main) : null;
        if(marks) it.tiers.forEach(t =>
        {
            const cell = el('i', t.done ? 'ogst_mPast' : '', marks);
            if(!t.reward) return;
            const mini = vault(cell, t.reward, 20);
            mini.classList.remove('ogst_vault');
            mini.classList.add('ogst_mCase');
            if(prize && t.tier === prize.tier && !t.done) mini.classList.add('ogst_mNext');
            mini.title = t.reward.label + (t.reward.kind === 'title' && t.reward.name ? ': ' + t.reward.name : '') +
                         ' — ' + T.grade + ' ' + t.tier;
            // Only this row previews: these thumbnails are the smallest and the ones you
            // scan on purpose. Popping one open from every case in the card was noise.
            mini.addEventListener('mouseenter', () => showPeek(mini, t.reward));
            mini.addEventListener('mouseleave', hidePeek);
        });

        // The ladder IS the tier structure: one segment per tier.
        const ladder = el('div', 'ogst_ladder', main);
        it.tiers.forEach(t =>
        {
            const seg = el('i', t.done ? 'ogst_lOn' : (t === cur && !it.doneAll ? 'ogst_lNow' : ''), ladder);
            if(t === cur && !t.done) seg.style.setProperty('--p', cur.pct + '%');
        });

        const meta = el('div', 'ogst_meta', main);
        el('span', 'ogst_grade', meta).textContent = T.grade + ' ' +
            Math.min(it.doneCnt + (it.doneAll ? 0 : 1), it.tiers.length) + ' ' + T.gradeOf + ' ' + it.tiers.length;
        if(!it.doneAll && cur.target > 0)
            el('span', 'ogst_count', meta).textContent = fmt(cur.current) + '/' + fmt(cur.target);
        const p = el('span', 'ogst_prize', meta);
        p.setAttribute('data-kind', prize ? prize.reward.kind : 'points');
        if(prize)
        {
            // The chip names the prize TYPE and the tier that hands it over; a title's own
            // name can run long, so it lives on the engraved plate and in the tooltip instead
            // of pushing the row out of shape.
            p.textContent = prize.reward.label + ' · ' + T.gradeShort + prize.tier;
            p.title = prize.reward.label + (prize.reward.kind === 'title' && prize.reward.name ? ': ' + prize.reward.name : '') +
                      ' — ' + T.grade + ' ' + prize.tier + '/' + it.tiers.length;
        }
        else { p.textContent = T.points; p.title = T.points; }

        const pin = el('div', 'ogst_pin' + (isPinned(it.id) ? ' ogst_on' : ''), top, isPinned(it.id) ? '★' : '☆');
        pin.title = T.pinned;
        pin.addEventListener('click', () => { togglePin(it.id); render(); });

        const open = !!ui.open[it.id];
        const more = el('div', 'ogst_more', c, (open ? '▾ ' : '▸ ') + (open ? T.hide : T.ladder));
        const box = el('div', 'ogst_tiers' + (open ? '' : ' ogst_hidden'), c);
        it.tiers.forEach(t =>
        {
            const isNow = !it.doneAll && t === cur;
            const line = el('div', 'ogst_tier' + (t.done ? ' ogst_tDone' : (isNow ? ' ogst_tNow' : '')), box);
            el('div', 'ogst_tStep', line).textContent = t.tier;
            if(t.reward) { const mini = vault(line, t.reward, 22); mini.classList.add('ogst_tCase'); mini.classList.remove('ogst_vault'); }
            const b = el('div', 'ogst_tBody', line);
            el('span', '', b).textContent = t.desc;
            if(t.reward)
            {
                const r = el('span', 'ogst_tPrize', b);
                r.setAttribute('data-kind', t.reward.kind);
                // Skins and avatars only have a technical id ("S10_A2_T4_PSKIN_ID1") — the type
                // says everything useful; titles are the one prize whose name is the prize.
                r.textContent = t.reward.label + (t.reward.kind === 'title' && t.reward.name ? ' · ' + t.reward.name : '');
            }
            if(!t.done && t.target > 0)
            {
                const bar = el('div', 'ogst_tBar', b);
                el('i', '', bar).style.width = t.pct + '%';
            }
            const v = el('div', 'ogst_tVal', line);
            v.textContent = t.done ? '✔' : (t.target > 0 ? fmt(t.current) + '/' + fmt(t.target) : '');
            if(t.done && t.at) v.title = T.unlocked + ': ' + t.at;
            else if(t.target > 0) v.title = t.pct + '%';
        });
        more.addEventListener('click', () =>
        {
            ui.open[it.id] = !ui.open[it.id];
            saveUi();
            const now = !!ui.open[it.id];
            box.classList.toggle('ogst_hidden', !now);
            more.textContent = (now ? '▾ ' : '▸ ') + (now ? T.hide : T.ladder);
        });
        return c;
    }

    function section(parent, key, label, items, emptyMsg)
    {
        const folded = !!ui[key];
        const head = el('div', 'ogst_secHead' + (folded ? ' ogst_folded' : ''), parent);
        el('span', 'ogst_caret', head, '▾');
        el('span', '', head).textContent = label + ' · ' + items.length;
        const list = el('div', 'ogst_list' + (folded ? ' ogst_hidden' : ''), parent);
        if(items.length) items.forEach(it => card(it, list));
        else el('div', 'ogst_empty', list, emptyMsg);
        head.addEventListener('click', () =>
        {
            ui[key] = !ui[key];
            saveUi();
            head.classList.toggle('ogst_folded', ui[key]);
            list.classList.toggle('ogst_hidden', ui[key]);
        });
    }

    function build()
    {
        injectStyle();
        if(wrap && wrap.isConnected) return;
        wrap = el('div', 'ogst_wrap', document.body);
        tab = el('div', 'ogst_tab', wrap);
        tab.addEventListener('click', () => setState('open'));
        panel = el('div', 'ogst_panel', wrap);
        peek = el('div', 'ogst_peek', wrap);
        place();
        window.addEventListener('resize', place, { passive: true });
    }

    // Anchor to the LEFT EDGE of the menu column and open LEFTWARDS, into the empty margin
    // beside the game frame — so the panel never lands on top of the game's own content.
    // The edge is measured at runtime; we never move, resize or cover the menu itself, the
    // banners or the footer (§1.7), and closed is the default state.
    function place()
    {
        if(!wrap) return;
        const links = document.querySelector('#links') || document.querySelector('#menuTable');
        const r = links ? links.getBoundingClientRect() : null;
        const edge = r ? r.left : 200;
        wrap.style.right = Math.max(0, window.innerWidth - edge) + 'px';
        wrap.style.left = 'auto';
        wrap.style.top = Math.max(8, r ? r.top : 120) + 'px';
        // Grow only into the free margin; beyond it we would push a scrollbar onto the page.
        if(panel) panel.style.maxWidth = Math.max(180, edge - 8) + 'px';
    }

    function fmtLeft(ms)
    {
        if(!(ms > 0)) return T.ended;
        const d = Math.floor(ms / 86400000);
        const h = Math.floor((ms % 86400000) / 3600000);
        return d > 0 ? d + 'g ' + h + 'h' : h + 'h';
    }

    function render()
    {
        if(!wrap || !wrap.isConnected) return;
        const items = (store && store.items) || [];
        const openPins = items.filter(it => isPinned(it.id) && !it.doneAll).length;

        tab.innerHTML = '';
        el('span', '', tab, '🏆 ' + T.title);
        if(openPins) el('span', 'ogst_tabBadge', tab).textContent = String(openPins);
        tab.classList.toggle('ogst_hidden', uiState !== 'closed');
        panel.classList.toggle('ogst_hidden', uiState === 'closed');
        if(uiState === 'closed') { hidePeek(); return; }

        hidePeek();
        panel.innerHTML = '';
        const head = el('div', 'ogst_head', panel);
        el('div', 'ogst_brand', head).textContent = T.title;

        const bRef = el('div', 'ogst_btn', head, '<span>⟳</span><span>' + T.reload + '</span>');
        bRef.title = T.refresh;
        bRef.addEventListener('click', () => refresh(bRef));

        const bClose = el('div', 'ogst_icon', head, '✕');
        bClose.title = T.close;
        bClose.addEventListener('click', () => setState('closed'));

        // Season banner: name, time left, and how much of it is already claimed. A label
        // computed from the expiry the page carries — it alerts nobody (§1.4).
        if(store && store.season)
        {
            const s = store.season;
            const box = el('div', 'ogst_season', panel);
            const top = el('div', 'ogst_sTop', box);
            el('div', 'ogst_sName', top).textContent = s.name;
            if(s.endsAt) el('div', 'ogst_sLeft', top).textContent = fmtLeft(s.endsAt - Date.now());
            if(s.total)
            {
                const bar = el('div', 'ogst_sBar', box);
                el('i', '', bar).style.width = Math.min(100, Math.round(s.doneCnt / s.total * 100)) + '%';
                const f = el('div', 'ogst_sFoot', box);
                el('span', '', f).innerHTML = '<b>' + s.doneCnt + '</b> / ' + s.total;
                if(s.endsAt) el('span', '', f).textContent = T.left;
            }
        }

        const tools = el('div', 'ogst_tools', panel);
        const input = el('input', '', tools);
        input.type = 'text';
        input.placeholder = T.search;
        input.value = ui.q || '';
        input.addEventListener('input', () => { ui.q = input.value; saveUi(); renderLists(); });

        const chips = el('div', 'ogst_chips', panel);
        [['todo', T.todo], ['all', T.all], ['done', T.done], ['pinned', '★ ' + T.onlyPins]].forEach(([k, label]) =>
        {
            const chip = el('div', 'ogst_chip' + (ui.filter === k ? ' ogst_on' : ''), chips, label);
            chip.addEventListener('click', () => { ui.filter = k; saveUi(); render(); });
        });

        const scroll = el('div', 'ogst_scroll', panel);
        function renderLists()
        {
            scroll.innerHTML = '';
            const vis = visibleItems();
            section(scroll, 'foldPins', T.pinned, vis.filter(it => isPinned(it.id)), T.noPins);
            section(scroll, 'foldList', T.list, vis.filter(it => !isPinned(it.id)), items.length ? T.noMatch : T.noData);
            // First run: one obvious button, so nobody has to go hunting for the Trophies
            // page. Same single, user-triggered read as the ⟳ icon.
            if(!items.length)
            {
                const load = el('div', 'ogst_load', scroll, T.loadNow + ' ⟳');
                load.addEventListener('click', () => refresh(load));
            }
        }
        renderLists();
        foot();

        function foot()
        {
            const f = el('div', 'ogst_foot', panel);
            el('span', '', f).textContent = items.length + ' · ' + T.read + ' ' +
                (store && store.at ? new Date(store.at).toLocaleString() : T.never);
            // Plain link to the game's own achievement view — the player navigates, we don't.
            const a = el('a', '', f);
            a.textContent = T.openGame + ' →';
            a.href = `https://${HOST}/game/index.php?page=ingame&component=playerprofile`;
        }
    }

    // --------------------------------------------------------------------- start
    // The panel lives outside the game's content, so it survives the game's re-renders; the
    // observer only re-places it and picks the achievement view up when the PLAYER opens one.
    // DOM-only observation — no server calls, no polling (§1.3/§4).
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
                if(ingestFromPage()) { if(wrap) render(); }
                else if(uiState !== 'closed' && !panel.firstChild) render();
            }
            catch(e) { console.error('[OGSeasonTracker] failed:', e); }
        });
    }

    function start()
    {
        try
        {
            if(seasonal === '0')
            {
                // Known non-seasonal universe: add nothing at all. The one exception is the
                // achievement view itself — a season may have started since, and re-reading
                // it costs nothing because the player already has it on screen.
                if(!document.querySelector('[id^="achievementContentList_season"]')) return;
                seasonal = null;
                try { localStorage.removeItem(LS.seas); } catch(e) {}
            }
            build();
            ingestFromPage();
            if(!wrap) return; // "not seasonal" verdict → teardown already removed the panel
            render();
            observer = new MutationObserver(tick);
            observer.observe(document.querySelector('#inhalt') || document.body, { childList: true, subtree: true });
            tick();
        }
        catch(e) { console.error('[OGSeasonTracker] failed:', e); }
    }

    start();
})();
