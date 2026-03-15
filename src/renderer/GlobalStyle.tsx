import React from 'react'

export const GlobalStyle = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg:          #f5f4f1;
      --bg2:         #eceae5;
      --bg3:         #e2e0d9;
      --surface:     #ffffff;
      --border:      #d8d5ce;
      --border2:     #c8c4bb;
      --text:        #1a1916;
      --text2:       #6b6760;
      --text3:       #9b9890;
      --accent:      #2563eb;
      --accent-bg:   #eff4ff;
      --accent2:     #16a34a;
      --accent2-bg:  #f0fdf4;
      --danger:      #dc2626;
      --danger-bg:   #fef2f2;
      --warn:        #d97706;
      --warn-bg:     #fffbeb;
      --radius:      8px;
      --radius-lg:   12px;
      --shadow:      0 1px 3px rgba(0,0,0,.08), 0 1px 2px rgba(0,0,0,.04);
      --shadow-md:   0 4px 12px rgba(0,0,0,.08), 0 2px 4px rgba(0,0,0,.04);
      --shadow-lg:   0 12px 32px rgba(0,0,0,.12), 0 4px 8px rgba(0,0,0,.06);
      --font:        'DM Sans', sans-serif;
      --mono:        'DM Mono', monospace;
      --titlebar:    28px;
    }

    html, body, #root { height: 100%; overflow: hidden; }

    body {
      font-family: var(--font);
      font-size: 13px;
      color: var(--text);
      background: var(--bg);
      -webkit-font-smoothing: antialiased;
    }

    ::-webkit-scrollbar { width: 5px; height: 5px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 99px; }

    input, textarea, select {
      font-family: var(--font);
      font-size: 13px;
      color: var(--text);
      outline: none;
    }

    button { cursor: pointer; font-family: var(--font); font-size: 13px; border: none; background: none; color: inherit; }

    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
    @keyframes slideIn { from { opacity: 0; transform: translateX(-8px); } to { opacity: 1; transform: none; } }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .5; } }
  `}</style>
)
