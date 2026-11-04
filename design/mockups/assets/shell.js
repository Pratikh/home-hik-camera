/* Home CCTV mockup shell — injects the shared chrome, icon sprite and nav.
   Static, dependency-free. Used only by design/mockups (not the app). */
(function () {
  "use strict";

  var ICONS = {
    dashboard: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    camera: '<path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h9A2.5 2.5 0 0 1 17 8.5v7A2.5 2.5 0 0 1 14.5 18h-9A2.5 2.5 0 0 1 3 15.5z"/><path d="M17 10.5l4-2.5v8l-4-2.5"/><circle cx="9.5" cy="12" r="1.6"/>',
    playback: '<circle cx="12" cy="12" r="9"/><path d="M10.5 8.6l5 3.4-5 3.4z"/>',
    events: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5z"/><path d="M8 9h8M8 13h8M8 17h4"/>',
    faces: '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><circle cx="12" cy="10.4" r="2.1"/><path d="M8.6 16c.5-1.7 1.8-2.6 3.4-2.6s2.9.9 3.4 2.6"/>',
    bell: '<path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 19a2.2 2.2 0 0 0 4 0"/>',
    device: '<rect x="3" y="4" width="18" height="7" rx="1.6"/><rect x="3" y="13" width="18" height="7" rx="1.6"/><path d="M7 7.5h.01M7 16.5h.01"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.2.5.62.87 1.16 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z"/>',
    user: '<circle cx="12" cy="8" r="3.4"/><path d="M5 20c.6-3.2 3.5-5 7-5s6.4 1.8 7 5"/>',
    logout: '<path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15"/><path d="M10 8l-4 4 4 4M6 12h9"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    chevronLeft: '<path d="M14.5 6l-6 6 6 6"/>',
    chevronRight: '<path d="M9.5 6l6 6-6 6"/>',
    chevronDown: '<path d="M6 9.5l6 6 6-6"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.4 15.4L20 20"/>',
    filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
    expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    alert: '<path d="M12 4.5l8.5 15H3.5z"/><path d="M12 10v4M12 17.2h.01"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.4 6.4"/><path d="M20 5v6h-6"/>',
    arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
    database: '<ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6"/><path d="M4.5 12v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6"/>',
    activity: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
    wifi: '<path d="M4.5 9.5a11 11 0 0 1 15 0M7.5 13a6.5 6.5 0 0 1 9 0M10.5 16.2a2.4 2.4 0 0 1 3 0"/><path d="M12 19.5h.01"/>',
    lock: '<rect x="4.5" y="10" width="15" height="10" rx="2"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/>',
    shield: '<path d="M12 3l7 2.8v5.4c0 4.6-3 8-7 9.8-4-1.8-7-5.2-7-9.8V5.8z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
    send: '<path d="M20 4L3.5 10.5l6 2.2 2.2 6z"/><path d="M20 4l-8.3 13.7"/>',
    eye: '<path d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.6"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15" rx="1.8"/><path d="M3.5 9.5h17M8 3.5V6M16 3.5V6"/>',
    image: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.8"/><circle cx="9" cy="9.5" r="1.6"/><path d="M4.5 17l4.6-4.4 3.4 3.2 2.6-2.4 4.4 4"/>',
    volume: '<path d="M5 9.5h3l4-3.5v12l-4-3.5H5z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
    mute: '<path d="M5 9.5h3l4-3.5v12l-4-3.5H5z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
    play: '<path d="M7 4.8l12 7.2-12 7.2z"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    fullscreen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    sliders: '<path d="M4 8h9M17 8h3M4 16h3M11 16h9"/><circle cx="15" cy="8" r="2"/><circle cx="9" cy="16" r="2"/>',
    users: '<circle cx="9" cy="8" r="3"/><path d="M3 19c.5-2.7 2.8-4.2 6-4.2s5.5 1.5 6 4.2"/><path d="M16 5.5a3 3 0 0 1 0 5.6M18 19c-.2-1.7-.8-2.9-1.8-3.7"/>',
    file: '<path d="M6 3.5h7l5 5v12H6z"/><path d="M13 3.5V9h5M9 13h6M9 16.5h6"/>',
    home: '<path d="M4 10.5L12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"/>',
    more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
    cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
    zap: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
    scan: '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><path d="M4 12h16"/>',
    key: '<circle cx="8" cy="14" r="3.4"/><path d="M10.6 11.4L19 3M15 7l2.4 2.4M17.6 4.4L20 6.8"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>'
  };

  var NAV = [
    { group: "Monitor", items: [
      { key: "dashboard", label: "Dashboard", href: "dashboard.html", icon: "dashboard" },
      { key: "playback", label: "Playback", href: "playback.html", icon: "playback" }
    ]},
    { group: "Security", items: [
      { key: "events", label: "Events", href: "events.html", icon: "events" },
      { key: "faces", label: "Faces", href: "faces.html", icon: "faces" },
      { key: "notifications", label: "Notifications", href: "notifications.html", icon: "bell" }
    ]},
    { group: "System", items: [
      { key: "cameras", label: "Camera setup", href: "cameras.html", icon: "camera" },
      { key: "device", label: "Device", href: "device.html", icon: "device" },
      { key: "settings", label: "Settings", href: "settings.html", icon: "settings" }
    ]}
  ];

  var MOBILE = [
    { key: "dashboard", label: "Dashboard", href: "dashboard.html", icon: "dashboard" },
    { key: "playback", label: "Playback", href: "playback.html", icon: "playback" },
    { key: "events", label: "Events", href: "events.html", icon: "events" },
    { key: "notifications", label: "Alerts", href: "notifications.html", icon: "bell" }
  ];

  function icon(name, cls) {
    return '<svg class="icon ' + (cls || "") + '" aria-hidden="true" focusable="false"><use href="#i-' + name + '"></use></svg>';
  }

  function sprite() {
    var body = "";
    for (var key in ICONS) {
      body += '<symbol id="i-' + key + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + ICONS[key] + "</symbol>";
    }
    return '<svg width="0" height="0" style="position:absolute" aria-hidden="true">' + body + "</svg>";
  }

  function mark() {
    return '<svg class="brand__mark" viewBox="0 0 32 32" aria-hidden="true"><rect x="0.5" y="0.5" width="31" height="31" rx="8" fill="#0f1a20" stroke="#2fe3c6" stroke-opacity="0.75"/><rect x="5.5" y="5.5" width="9" height="9" rx="2.2" fill="#2fe3c6"/><rect x="17.5" y="5.5" width="9" height="9" rx="2.2" fill="#7cf2e0" fill-opacity="0.72"/><rect x="5.5" y="17.5" width="9" height="9" rx="2.2" fill="#7cf2e0" fill-opacity="0.72"/><rect x="17.5" y="17.5" width="9" height="9" rx="2.2" fill="#2fe3c6"/></svg>';
  }

  function sidebar(screen) {
    var html = '<aside class="sidebar"><div class="brand">' + mark() +
      '<div><div class="brand__name">Home CCTV</div><div class="brand__sub">Local hub</div></div></div><nav class="nav" aria-label="Primary">';
    NAV.forEach(function (group) {
      html += '<div class="nav__group"><div class="nav__label">' + group.group + "</div>";
      group.items.forEach(function (item) {
        var current = item.key === screen ? ' aria-current="page"' : "";
        var badge = item.key === "events" && screen === "events" ? '<span class="nav__badge">3</span>' : "";
        html += '<a class="nav__item" href="' + item.href + '"' + current + ">" + icon(item.icon) + "<span>" + item.label + "</span>" + badge + "</a>";
      });
      html += "</div>";
    });
    html += '</nav><div class="sidebar__foot">' +
      '<div class="shell-status"><div class="shell-status__head"><span>System</span><span>' + icon("shield", "icon-sm") + '</span></div><div class="shell-status__rows">' +
      '<div class="shell-status__row"><span class="dot dot--online"></span><span>DVR</span><span>Online</span></div>' +
      '<div class="shell-status__row"><span class="dot dot--online"></span><span>Video gateway</span><span>Live</span></div>' +
      '<div class="shell-status__row"><span class="dot dot--idle"></span><span>Database</span><span>OK</span></div>' +
      '</div></div>' +
      '<a class="sidebar__account" href="account.html"><span class="avatar">H</span><span>home</span><span class="badge" style="margin-left:auto">Admin</span></a>' +
      '<a class="logout-btn" href="login.html">' + icon("logout") + "<span>Log out</span></a>" +
      "</div></aside>";
    return html;
  }

  function appbar(screen, crumb) {
    return '<header class="appbar">' +
      '<div class="mobile-brand">' + mark() + '<span class="mobile-brand__name">Home CCTV</span></div>' +
      '<div class="appbar__crumb"><strong>Home CCTV</strong><span class="sep">/</span><span>' + crumb + "</span></div>" +
      '<div class="appbar__spacer"></div>' +
      '<div class="appbar__actions">' +
      '<span class="pill pill--hide-sm"><span class="dot dot--online"></span>All systems nominal</span>' +
      '<button class="btn btn--sm" type="button">' + icon("bell", "icon-sm") + "<span>Enable notifications</span></button>" +
      '<div class="clock"><span class="clock__time">01:48:28 PM</span><span class="clock__date">Tue, 04 Nov 2026</span></div>' +
      '<button class="icon-btn" type="button" aria-label="Account menu"><span class="avatar">H</span></button>' +
      "</div></header>";
  }

  function mobileNav(screen) {
    var html = '<nav class="mobile-nav" aria-label="Primary">';
    MOBILE.forEach(function (item) {
      var current = item.key === screen ? ' aria-current="page"' : "";
      html += '<a class="mobile-nav__item" href="' + item.href + '"' + current + ">" + icon(item.icon) + "<span>" + item.label + "</span></a>";
    });
    html += '<button class="mobile-nav__more" type="button" data-more>' + icon("more") + "<span>More</span></button></nav>";
    html += '<div class="sheet-backdrop" data-sheet-close></div><div class="sheet" data-sheet aria-hidden="true"><div class="sheet__handle"></div><div class="sheet__grid">' +
      '<a class="sheet__item" href="faces.html">' + icon("faces") + "Faces</a>" +
      '<a class="sheet__item" href="cameras.html">' + icon("camera") + "Camera setup</a>" +
      '<a class="sheet__item" href="device.html">' + icon("device") + "Device</a>" +
      '<a class="sheet__item" href="settings.html">' + icon("settings") + "Settings</a>" +
      '<a class="sheet__item" href="account.html">' + icon("user") + "Account</a>" +
      '<a class="sheet__item" href="login.html">' + icon("logout") + "Log out</a>" +
      "</div></div>";
    return html;
  }

  function boot() {
    var page = document.querySelector("main.page");
    var body = document.body;
    var screen = body.getAttribute("data-nav") || "dashboard";
    var crumb = body.getAttribute("data-crumb") || "Dashboard";

    var shell = document.createElement("div");
    shell.className = "shell";
    shell.innerHTML = '<div class="shell__body">' + sidebar(screen) +
      '<div class="content">' + appbar(screen, crumb) + "</div></div>";
    var content = shell.querySelector(".content");
    content.appendChild(page);
    body.insertBefore(shell, body.firstChild);
    body.insertAdjacentHTML("beforeend", sprite() + mobileNav(screen));

    var sheet = document.querySelector("[data-sheet]");
    var backdrop = document.querySelector("[data-sheet-close]");
    var more = document.querySelector("[data-more]");
    function setOpen(open) {
      sheet.setAttribute("data-open", String(open));
      sheet.setAttribute("aria-hidden", String(!open));
      if (backdrop) backdrop.setAttribute("data-open", String(open));
    }
    if (more) more.addEventListener("click", function () { setOpen(true); });
    if (backdrop) backdrop.addEventListener("click", function () { setOpen(false); });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") setOpen(false);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
