"use strict";

const main = document.querySelector("#main");
const songDock = document.createElement("aside");
songDock.className = "album-song-dock";
songDock.setAttribute("aria-label","Album music");
songDock.hidden = true;
document.body.append(songDock);
const tabs = document.querySelector("#tabs");
const dialog = document.querySelector("#dialog");
const config = window.albumConfig || {};
const cloud = true;
const start = Date.parse("2026-11-05T00:00:00+02:00");
const seed = [], previewPhotos = [], previousSeedBodies = {};
const labels = { home:"Home", memories:"Memories", calendar:"Calendar", letter:"For Sondos", manage:"Dashboard" };
const paths = {
  home:"M3 11 12 3l9 8v9H3z M9 20v-6h6v6",
  memories:"M4 4h7v16H4z M13 4h7v16h-7z M7 8h1 M16 8h1",
  calendar:"M3 6h18v15H3z M7 3v6 M17 3v6 M3 11h18 M8 16h2 M14 16h2",
  letter:"M3 5h18v14H3z M3 6l9 7 9-7"
};
let api, db, role, sender, userId, records = [], opened = false, alertTimer, photoUrls = new Map();
let anchoredSection, revealObserver;
let loginReady = false, loginUnavailable = false, loginIdentity;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const dates = new Intl.DateTimeFormat("en-GB", { day:"numeric", month:"long", year:"numeric" });
const months = new Intl.DateTimeFormat("en-GB", { month:"long", year:"numeric" });
const cairo = new Intl.DateTimeFormat("en-CA", { timeZone:"Africa/Cairo", year:"numeric", month:"2-digit", day:"2-digit" });
function dateKey(parts) {
  const values = Object.fromEntries(parts.map(({type,value}) => [type,value]));
  return [values.year, values.month, values.day].join("-");
}
const today = () => dateKey(cairo.formatToParts(new Date()));
const localDate = value => new Date(value + "T12:00:00");
const key = date => [date.getFullYear(), String(date.getMonth()+1).padStart(2,"0"), String(date.getDate()).padStart(2,"0")].join("-");
let selected = today(), month = localDate(selected.slice(0,7) + "-01");

function esc(value = "") {
  return String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
}
const find = id => records.find(item => item.id === id);
const dashboardOpen = () => role === "editor" && location.hash === "#manage";
const canEdit = item => Boolean(item && (!cloud || (
  item.kind === "letter" ? (item.letter_from || "mostafa") === sender :
  sender === "mostafa" || item.created_by === userId
)));
const ofKind = kind => records.filter(item => item.kind === kind).sort((a,b) =>
  kind === "letter"
    ? (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0)
    : (b.date || "").localeCompare(a.date || "")
);
const formatDate = value => value ? '<time datetime="' + esc(value) + '">' + dates.format(localDate(value)) + '</time>' : "";
const action = (type, name, value = "", style = "plain") => '<button type="button" class="' + style + '" data-' + type + '="' + esc(value) + '">' + esc(name) + '</button>';
const empty = message => '<p class="empty">' + esc(message) + '</p>';
function notify(message) {
  clearTimeout(alertTimer);
  document.querySelector("#status").textContent = message;
  alertTimer = setTimeout(() => document.querySelector("#status").textContent = "", 5500);
}

function openLocal() {
  return new Promise((resolve,reject) => {
    const request = indexedDB.open("sondos-and-mostafa-album", 5);
    request.onupgradeneeded = ({oldVersion}) => {
      const store = oldVersion === 0
        ? request.result.createObjectStore("entries", {keyPath:"id"})
        : request.transaction.objectStore("entries");
      if (oldVersion === 0) {
        seed.forEach(item => store.put(item));
      } else {
        for (const entry of seed) {
          const existing = store.get(entry.id);
          existing.onsuccess = () => {
            const item = existing.result;
            if (!item) return;
            const body = previousSeedBodies[entry.id].includes(item.body) ? entry.body : item.body;
            const title = entry.id === "first" && item.title === "The first time we sat together" ? entry.title : item.title;
            if (body !== item.body || title !== item.title) store.put({...item, body, title});
          };
        }
      }
      for (const photo of previewPhotos) {
        if (oldVersion < 2) {
          store.put(photo);
          continue;
        }
        if (oldVersion === 2) {
          const existing = store.get(photo.id);
          existing.onsuccess = () => {
            const item = existing.result;
            if (item && !item.title.trim()) store.put({...item, title:photo.title});
          };
        }
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onblocked = () => notify("Close other album tabs to finish updating the preview.");
    request.onerror = () => reject(request.error);
  });
}
function localOperation(mode, operate) {
  return new Promise((resolve,reject) => {
    const transaction = db.transaction("entries",mode);
    const request = operate(transaction.objectStore("entries"));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(transaction.error);
  });
}
function checked(result) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
async function refresh() {
  const next = cloud ? checked(await api.from("album_entries").select("*")) : await localOperation("readonly", store => store.getAll());
  const liveIds = new Set(next.filter(item => item.kind === "photo").map(item => item.id));
  for (const [id,url] of photoUrls) {
    if (liveIds.has(id)) continue;
    URL.revokeObjectURL(url);
    photoUrls.delete(id);
  }
  const failed = await Promise.all(next.filter(item => liveIds.has(item.id) && !photoUrls.has(item.id)).map(async item => {
    try {
      if (!cloud && item.preview_path) {
        photoUrls.set(item.id,item.preview_path);
        return false;
      }
      const blob = cloud ? checked(await api.storage.from("album-photos").download(item.storage_path)) : item.file;
      photoUrls.set(item.id, URL.createObjectURL(blob));
      return false;
    } catch { return true; }
  }));
  records = next;
  if (failed.some(Boolean)) notify("Some photos could not be loaded.");
}
async function save(item, file) {
  if (!cloud) return localOperation("readwrite", store => store.put(file ? {...item,file} : item));
  if (file) {
    item.storage_path = "pictures/" + item.id;
    checked(await api.storage.from("album-photos").upload(item.storage_path,file,{contentType:file.type}));
  }
  try {
    const entries = api.from("album_entries");
    const query = find(item.id) ? entries.update(item).eq("id",item.id) : entries.insert(item);
    checked(await query.select("id").single());
  } catch (error) {
    if (file) await api.storage.from("album-photos").remove([item.storage_path]);
    throw error;
  }
}
async function remove(item) {
  if (!cloud) return localOperation("readwrite", store => {
    for (const photo of records.filter(photo => photo.parent_id === item.id)) store.put({...photo,parent_id:null});
    return store.delete(item.id);
  });
  checked(await api.from("album_entries").delete().eq("id",item.id).select("id").single());
  if (item.storage_path) {
    const result = await api.storage.from("album-photos").remove([item.storage_path]);
    if (result.error) return "Removed from the album. Storage cleanup failed.";
  }
}

function photos(items) {
  if (!items.length) return empty("Photos of Sondos and Mostafa will show up here.");
  return '<div class="grid">' + items.map(item => {
    const url = photoUrls.get(item.id);
    return '<button class="photo" data-view-photo="' + esc(item.id) + '"' + (url ? "" : " disabled") + ' aria-label="' + esc(item.title || "Open photo") + '">' +
      (url ? '<img src="' + esc(url) + '" alt="' + esc(item.title || "Photo from Sondos and Mostafa’s album") + '" loading="lazy">' : '<span>Photo unavailable</span>') +
      (item.title ? '<span>' + esc(item.title) + '</span>' : '') + '</button>';
  }).join("") + '</div>';
}
function row(item, detail = false, manage = false) {
  const photoCount = ofKind("photo").filter(photo => photo.parent_id === item.id).length;
  const viewing = item.kind === "memory" || item.kind === "event";
  return '<article class="row"><div><h3>' + esc(item.title || "Untitled photo") + '</h3>' + formatDate(item.date) +
    (item.annual ? ' <small>· Repeats every year</small>' : '') +
    (manage && item.kind === "letter" ? '<small>From ' + (item.letter_from === "sondos" ? 'Sondos to Mostafa' : 'Mostafa to Sondos') + '</small>' : '') +
    (detail && item.body ? '<p class="preserve">' + esc(item.body) + '</p>' : '') +
    (photoCount ? '<p><small>' + photoCount + (photoCount === 1 ? ' photo' : ' photos') + '</small></p>' : '') +
    '</div><div class="actions">' +
    (manage && canEdit(item) ? action("edit","Edit",item.id,"plain small-button") : '') +
    (viewing ? action("view","Open",item.id,"plain small-button") : item.kind === "photo" ? action("view-photo","Open",item.id,"plain small-button") : '') +
    '</div></article>';
}
function memoryFeed() {
  const pictures = ofKind("photo");
  const byMemory = new Map();
  for (const picture of pictures) {
    if (!picture.parent_id) continue;
    if (!byMemory.has(picture.parent_id)) byMemory.set(picture.parent_id, []);
    byMemory.get(picture.parent_id).push(picture);
  }
  const stories = [...ofKind("memory"), ...ofKind("event").filter(item => byMemory.has(item.id))];
  const storyIds = new Set(stories.map(item => item.id));
  const entries = [...stories, ...pictures.filter(picture => !storyIds.has(picture.parent_id))]
    .sort((a,b) => (b.date || "").localeCompare(a.date || ""));

  return '<div class="heading"><h2 class="landing-title">Our Memories</h2></div><div class="memory-feed">' + (entries.length ? entries.map(item => {
      if (item.kind === "photo") {
        return '<article class="photo-memory">' + photos([item]) + (item.date ? formatDate(item.date) : '') + '</article>';
      }
      const attached = byMemory.get(item.id) || [];
      return '<article class="memory-story panel"><div class="memory-copy">' + formatDate(item.date) +
        '<h3>' + esc(item.title) + '</h3>' + (item.body ? '<p class="preserve">' + esc(item.body) + '</p>' : '') + '</div>' +
        (attached.length ? photos(attached) : '') + '</article>';
    }).join("") : empty("Your memories will show up here.")) + '</div>';
}
function home() {
  const gallery = ofKind("photo");
  const cover = gallery.find(item => item.id === "preview-selfie" && photoUrls.has(item.id)) ||
    gallery.find(item => photoUrls.has(item.id));
  return '<section class="hero' + (cover ? ' has-image' : '') + '">' +
    (cover ? '<img src="' + esc(photoUrls.get(cover.id)) + '" alt="">' : '') +
    '<div class="hero-copy"><time datetime="2026-11-05">Together since 5 November 2026</time><h1>Sondos &amp; Mostafa</h1>' +
    '<p>I made this for you, Sondos, so we have somewhere to keep the days we want to remember.</p>' +
    '<a class="hero-link" href="#letter">Read my letter</a></div></section>' +
    '<section class="section"><div class="heading"><h2>Since we got together</h2></div><div class="counter">' +
    ["Days","Hours","Minutes","Seconds"].map((label,index) => '<div><b id="count-' + index + '">0</b><span>' + label + '</span></div>').join("") +
    '</div></section>';
}
function tick() {
  const seconds = Math.max(0, Math.floor((Date.now() - start)/1000));
  [Math.floor(seconds/86400),Math.floor(seconds/3600)%24,Math.floor(seconds/60)%60,seconds%60].forEach((number,index) => {
    const element = document.getElementById("count-" + index);
    if (element) element.textContent = String(number).padStart(2,"0");
  });
}
function eventsOn(day) {
  return [...ofKind("event"), ...ofKind("memory")].filter(item =>
    item.annual ? item.date.slice(5) === day.slice(5) : item.date === day
  );
}
function calendar() {
  const year = month.getFullYear(), index = month.getMonth();
  const cells = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(day => '<small>' + day + '</small>');
  for (let i=0;i<month.getDay();i++) cells.push("<span></span>");
  const length = new Date(year,index+1,0).getDate();
  for (let number=1;number<=length;number++) {
    const day = key(new Date(year,index,number,12));
    const items = eventsOn(day);
    cells.push('<button type="button" class="day' + (items.length ? ' has-event' : '') + '" data-day="' + day + '" aria-label="' +
      dates.format(localDate(day)) + (items.length ? ', ' + items.map(item => esc(item.title)).join(", ") : '') + '" aria-pressed="' + (day === selected) + '"' +
      (day === today() ? ' aria-current="date"' : '') + '>' + number + '</button>');
  }
  const items = eventsOn(selected);
  return '<div class="heading"><h2 class="landing-title">Our dates</h2></div><section class="panel calendar"><div class="heading">' +
    action("month","Previous","-1") + '<h2>' + months.format(month) + '</h2>' + action("month","Next","1") + '</div>' +
    '<div class="cal-grid">' + cells.join("") + '</div></section><section class="section"><div class="heading"><h2>' +
    dates.format(localDate(selected)) + '</h2></div>' +
    (items.length ? action("day-details","View day details",selected) : empty("Nothing in our calendar for this day.")) + '</section>';
}
function letters() {
  const entries = ofKind("letter");
  const directions = [
    ["mostafa", "For Sondos", "Mostafa"],
    ["sondos", "Letters to Mostafa", "Sondos"]
  ];
  return directions.filter(([sender]) => sender === "mostafa" || entries.some(item => item.letter_from === sender)).map(([sender, title, signature], index) => {
    const matching = entries.filter(item => (item.letter_from || "mostafa") === sender);
    return '<div class="' + (index ? 'section' : '') + '"><div class="heading"><h2 class="landing-title">' + title + '</h2></div>' +
      (matching.length ? '<div class="list">' + matching.map(item => '<details class="panel letter-entry"><summary>' +
        (item.created_at ? formatDate(dateKey(cairo.formatToParts(new Date(item.created_at)))) : '<span class="muted">From ' + signature + '</span>') +
        '<span class="primary letter-toggle"><span class="when-closed">Show letter</span><span class="when-open">Hide letter</span></span>' +
        '</summary><article class="letter-reading"><h3>' + esc(item.title) + '</h3><p class="preserve">' + esc(item.body) +
        '</p><span class="signature">' + signature + '</span></article></details>').join("") + '</div>' : empty("No letters yet.")) + '</div>';
  }).join("");
}
function dashboard() {
  const groups = [["photo","Photos"],["memory","Memories"],["event","Special dates"],["letter","Letters"]];
  return '<div class="heading"><h1>Dashboard</h1></div>' +
    groups.map(([kind,title]) => '<section class="section"><div class="heading"><h2>' +title+ '</h2>' +
      action("new","Add " + kind,kind,"primary") + '</div>' +
      (ofKind(kind).length ? '<div class="list">' + ofKind(kind).map(item => row(item,false,true)).join("") + '</div>' : empty("Nothing added yet.")) + '</section>').join("");
}
function resolveAlbumEmail(input) {
  const alias = /^yours-([a-z0-9_-]{16})$/i.exec(input);
  if (alias) {
    const bytes = atob(alias[1].replace(/-/g,"+").replace(/_/g,"/"));
    const code = Array.from(bytes, byte => byte.charCodeAt(0).toString(16).padStart(2,"0")).join("");
    return "mostafa-" + code + "@album.example";
  }
  const email = input.toLowerCase();
  return email === "darling" ? "sondos@album.example" : email;
}

function loginScreen() {
  const welcome = '<section class="login stack"><div class="welcome"><h1>For you, Sondos.</h1>' +
    '<p>A little place for our photos, our dates, and the things I want to tell you.</p><span class="signature">Mostafa</span></div>';
  if (!cloud) return welcome + '<div class="panel stack"><p class="muted">This is a local preview. Changes stay in this browser.</p>' +
    action("preview","Open the preview","","primary") + '</div></section>';
  if (loginUnavailable) return welcome + '<div class="panel stack"><p>We couldn’t connect to the album. Try again in a moment.</p>' +
    action("retry-login","Try again","","primary") + '</div></section>';
  const email = loginIdentity?.email;
  const isSondos = email === "sondos@album.example";
  const fields = email
    ? '<input type="hidden" name="email" value="' + esc(email) + '" autocomplete="username">' +
      '<div class="login-greeting"><h2>' + (isSondos ? 'Hi, Sondos ♡' : 'You’re not important.') + '</h2>' +
      (isSondos ? '' : '<p>Just kidding.</p>') + '</div><label for="album-password">Password</label>' +
      '<div class="password-field"><input id="album-password" name="password" type="password" autocomplete="current-password" required>' +
      '<button type="button" class="plain small-button" data-password-visibility aria-label="Show password" aria-controls="album-password">Show</button></div>'
    : '<label for="album-email">Email or nickname</label><input id="album-email" name="email" value="' + esc(loginIdentity?.input || "") +
      '" autocomplete="username" inputmode="email" autocapitalize="none" spellcheck="false" required>';
  const submit = email ? "Open our album" : "Continue";
  return welcome + '<form id="login" class="panel stack">' + fields +
    '<button type="submit" class="primary"' + (loginReady ? '' : ' disabled') + '>' +
    (loginReady ? submit : 'Connecting…') + '</button>' +
    (email ? '<button type="button" class="plain small-button login-back" data-login-back>Use another email</button>' : '') +
    '<p class="form-note" role="status"></p></form></section>';
}

function render() {
  const account = document.querySelector("#account");
  main.removeAttribute("aria-busy");
  revealObserver?.disconnect();
  if (!opened) {
    tabs.hidden = true;
    account.innerHTML = "";
    main.innerHTML = loginScreen();
    return;
  }
  const managing = dashboardOpen();
  const pages = {
    home,
    memories: memoryFeed,
    calendar,
    letter: letters
  };
  account.innerHTML = '<div class="top-actions">' + (role === "editor" ? '<a class="plain small-button" href="#manage">Dashboard</a>' : '') +
    action("logout",cloud ? "Sign out" : "Close","","plain small-button") + '</div>';
  tabs.innerHTML = Object.entries(paths).map(([id,path]) => '<a href="#' + id + '"' +
    '><svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + path + '"></path></svg>' + labels[id] + '</a>').join("");
  tabs.hidden = false;
  main.innerHTML = managing ? dashboard() : Object.keys(paths).map(id =>
    '<section class="landing-section" id="' + id + '" aria-label="' + labels[id] + '">' + pages[id]() + '</section>'
  ).join("");
  tick();
  updateActiveTab();
  revealSections();
}

function revealSections() {
  if (reducedMotion.matches || !("IntersectionObserver" in window)) return;
  revealObserver = new IntersectionObserver((entries, observer) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("in-view");
      observer.unobserve(entry.target);
    }
  }, {threshold:.08});
  for (const element of main.querySelectorAll(".memory-story, .photo-memory, .calendar, .letter-entry, .counter")) {
    revealObserver.observe(element);
  }
}

function updateActiveTab() {
  const sections = [...main.querySelectorAll(".landing-section")];
  let active = sections[0]?.id;
  for (const section of sections) {
    if (section.getBoundingClientRect().top > 100) break;
    active = section.id;
  }
  if (sections.length && window.scrollY > 0 &&
      window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2) {
    active = sections.at(-1).id;
  }
  if (anchoredSection && Math.abs(window.scrollY - anchoredSection.offset) <= 4) active = anchoredSection.id;
  else anchoredSection = null;
  for (const link of tabs.querySelectorAll("a")) {
    if (link.hash === "#" + active) link.setAttribute("aria-current","location");
    else link.removeAttribute("aria-current");
  }
}

function goToSection(focus = false) {
  const id = location.hash === "#photos" ? "memories" : location.hash.slice(1) || "home";
  const section = Object.hasOwn(paths,id) ? document.getElementById(id) : null;
  const heading = section?.querySelector("h1,h2") || main.querySelector("h1");
  if (focus && heading) {
    heading.setAttribute("tabindex","-1");
    heading.focus({preventScroll:true});
  }
  if (section && id !== "home") section.scrollIntoView();
  else window.scrollTo(0,0);
  anchoredSection = section ? {id, offset:window.scrollY} : null;
  updateActiveTab();
}

function showDialog(title, content) {
  dialog.innerHTML = '<div class="heading"><h2 id="dialog-title">' + esc(title) + '</h2>' + action("close","Close") + '</div>' + content;
  dialog.setAttribute("aria-labelledby","dialog-title");
  if (!dialog.open) dialog.showModal();
  else dialog.querySelector("[data-close]").focus({preventScroll:true});
}
function entryForm(kind, item, parentId) {
  const photo = kind === "photo", letter = kind === "letter";
  const event = kind === "event";
  const title = item?.title || "";
  const related = [...ofKind("memory"),...ofKind("event")];
  const linked = item?.parent_id || parentId;
  showDialog((item ? "Edit " : "Add ") + kind,'<form id="entry" class="stack" data-kind="' + kind + '" data-id="' + esc(item?.id) + '">' +
    '<label>Title' + (photo ? ' (optional)' : '') + '<input name="title" maxlength="120" value="' + esc(title) + '"' + (photo ? "" : " required") + '></label>' +
    (!letter ? '<label>Date' + (photo ? " (optional)" : "") + '<input name="date" type="date" value="' + esc(item?.date ?? (photo ? find(linked)?.date || "" : event ? selected : today())) + '"' + (photo ? "" : " required") + '></label>' : '') +
    (letter && !cloud ? '<label>From<select name="letter_from"><option value="mostafa">Mostafa to Sondos</option>' +
      '<option value="sondos"' + (item?.letter_from === "sondos" ? ' selected' : '') + '>Sondos to Mostafa</option></select></label>' : '') +
    (event ? '<label class="check"><input name="annual" type="checkbox"' + (item?.annual ? " checked" : "") + '> Repeat every year</label>' : '') +
    (!photo ? '<label>' + (letter ? "Letter" : "Your story (optional)") + '<textarea name="body" maxlength="10000"' + (letter ? " required" : "") + '>' + esc(item?.body) + '</textarea></label>' :
     '<label>Attach to a memory or event<select name="parent_id"><option value="">General album</option>' + related.map(parent => '<option value="' + esc(parent.id) + '"' + (linked === parent.id ? " selected" : "") + '>' + esc(parent.title) + '</option>').join("") + '</select></label>') +
    (photo && !item ? '<label>Photo<input type="file" name="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" required></label><small>JPEG, PNG, WebP, GIF or AVIF · up to 15 MB each.</small>' : '') +
    '<div class="actions"><button class="primary">Save</button>' + (item ? action("delete","Delete",item.id) : '') +
    '</div><p class="form-note" role="status"></p></form>');
}
function itemDetails(item, date = item.date) {
  const attached = ofKind("photo").filter(photo => photo.parent_id === item.id);
  return '<div class="stack">' + formatDate(date) + (item.annual ? '<small>Repeats every year</small>' : '') +
    (item.body ? '<p class="preserve">' + esc(item.body) + '</p>' : '') + (attached.length ? photos(attached) : '') +
    (dashboardOpen() && canEdit(item) ? '<div class="actions">' + action("attach","Add a photo",item.id,"primary") + action("edit","Edit",item.id) + '</div>' : '') + '</div>';
}
function viewItem(item) {
  showDialog(item.title,itemDetails(item));
}
function viewDay(day) {
  const items = eventsOn(day);
  if (!items.length) return;
  if (items.length === 1) {
    showDialog(items[0].title,itemDetails(items[0],day));
    return;
  }
  showDialog(dates.format(localDate(day)),'<div class="stack">' + items.map(item =>
    '<article class="panel stack"><h3>' + esc(item.title) + '</h3>' + itemDetails(item,day) + '</article>'
  ).join("") + '</div>');
}

async function startSession() {
  if (cloud) {
    const [roleResult, senderResult, userResult] = await Promise.all([
      api.rpc("album_role"), api.rpc("album_sender"), api.auth.getUser()
    ]);
    role = checked(roleResult);
    sender = checked(senderResult);
    userId = checked(userResult).user?.id;
    if (!["editor","viewer"].includes(role) || (role === "editor" && !["mostafa","sondos"].includes(sender))) {
      await api.auth.signOut({scope:"local"});
      throw new Error("This account doesn’t have access to the album.");
    }
  } else {
    db ||= await openLocal();
    role = "editor";
  }
  await refresh();
  opened = true;
  if (!cloud) sessionStorage.setItem("album-preview-open","1");
  render();
  goToSection();
  songDock.hidden = false;
  songDock.innerHTML = '<a class="plain small-button" href="https://www.youtube.com/watch?v=tyKu0uZS86Q" ' +
    'aria-label="Listen to Valentine by Laufey on YouTube" target="_blank" rel="noopener noreferrer">♪ Valentine</a>';
}
function clearSession() {
  for (const url of photoUrls.values()) URL.revokeObjectURL(url);
  photoUrls.clear();
  records = [];
  opened = false;
  songDock.hidden = true;
  songDock.replaceChildren();
  if (!cloud) sessionStorage.removeItem("album-preview-open");
  role = sender = userId = null;
  loginIdentity = null;
  if (dialog.open) dialog.close();
  render();
}
document.addEventListener("click", async event => {
  const anchor = event.target.closest('a[href^="#"]');
  if (opened && anchor?.hash === location.hash && Object.hasOwn(paths,anchor.hash.slice(1)) &&
      !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    goToSection(true);
    return;
  }
  const button = event.target.closest("button");
  if (!button) return;
  const data = button.dataset;
  try {
    if ("loginBack" in data) {
      loginIdentity = {input:loginIdentity?.input};
      render();
      document.getElementById("album-email").focus();
      return;
    }
    if ("passwordVisibility" in data) {
      const password = document.getElementById("album-password");
      const showing = password.type === "password";
      password.type = showing ? "text" : "password";
      button.textContent = showing ? "Hide" : "Show";
      button.setAttribute("aria-label", showing ? "Hide password" : "Show password");
      return;
    }
    if ("retryLogin" in data) {
      location.reload();
      return;
    }
    if ("preview" in data && !cloud) {
      button.disabled = true;
      await startSession();
    }
    if ("logout" in data) {
      button.disabled = true;
      if (cloud) checked(await api.auth.signOut({scope:"local"}));
      if (opened) clearSession();
      return;
    }
    if ("close" in data && dialog.open) dialog.close();
    if ("day" in data) {
      selected = data.day;
      document.getElementById("calendar").innerHTML = calendar();
      main.querySelector('[aria-pressed="true"]')?.focus({preventScroll:true});
      viewDay(selected);
    }
    if ("dayDetails" in data) viewDay(data.dayDetails);
    if ("month" in data) {
      month = new Date(month.getFullYear(),month.getMonth()+Number(data.month),1,12);
      selected = key(month);
      document.getElementById("calendar").innerHTML = calendar();
      main.querySelector('[data-month="' + data.month + '"]')?.focus({preventScroll:true});
    }
    if ("view" in data && find(data.view)) viewItem(find(data.view));
    if ("viewPhoto" in data && photoUrls.has(data.viewPhoto)) {
      const item = find(data.viewPhoto);
      const title = item.title || "Our photo";
      showDialog(title,'<img class="full-photo" src="' + esc(photoUrls.get(item.id)) + '" alt="' + esc(title) + '">' +
        formatDate(item.date) + (find(item.parent_id) ? action("view","Open its memory or event",item.parent_id) : ""));
    }
    if (!dashboardOpen()) return;
    if ("new" in data) entryForm(data.new);
    if ("edit" in data && canEdit(find(data.edit))) entryForm(find(data.edit).kind,find(data.edit));
    if ("attach" in data && canEdit(find(data.attach))) entryForm("photo",null,data.attach);
    if ("delete" in data && canEdit(find(data.delete))) {
      const item = find(data.delete);
      const attached = ofKind("photo").some(photo => photo.parent_id === item.id);
      if (!confirm(attached ? "Delete this entry? Its photos will stay in the album." : "Delete this entry?")) return;
      button.disabled = true;
      const warning = await remove(item);
      dialog.close();
      await refresh();
      render();
      notify(warning || "Deleted.");
    }
  } catch (error) {
    button.disabled = false;
    notify(error.message);
  }
});

document.addEventListener("submit", async event => {
  const form = event.target;
  if (form.id !== "login" && form.id !== "entry") return;
  event.preventDefault();
  const button = form.querySelector('button:not([type="button"])');
  const note = form.querySelector(".form-note");
  if (button.disabled) return;
  button.disabled = true;
  note.textContent = "";
  const buttonLabel = button.textContent;
  const back = form.querySelector("[data-login-back]");
  if (back) back.disabled = true;
  button.textContent = form.id === "login" ? (loginIdentity?.email ? "Opening…" : buttonLabel) : "Saving…";
  const fields = new FormData(form);
  const value = key => fields.get(key)?.trim() || "";
  try {
    if (form.id === "login") {
      if (!loginReady) return;
      if (!loginIdentity?.email) {
        const input = value("email");
        const email = resolveAlbumEmail(input);
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Enter your album email or nickname.");
        loginIdentity = {input,email};
        render();
        document.getElementById("album-password").focus();
        return;
      }
      const result = await api.auth.signInWithPassword({email:loginIdentity.email,password:fields.get("password")});
      if (result.error?.code === "invalid_credentials") throw new Error("That email or password didn’t match. Try again.");
      checked(result);
      await startSession();
      return;
    }
    if (!dashboardOpen()) return;
    const {kind,id} = form.dataset;
    const current = find(id);
    if (id && !canEdit(current)) throw new Error("You can only change entries you’re allowed to edit.");
    const file = fields.get("file");
    if (file && (!["image/jpeg","image/png","image/webp","image/gif","image/avif"].includes(file.type) || file.size < 1 || file.size > 15 * 1024 * 1024)) {
      throw new Error("Choose a supported image up to 15 MB.");
    }
    if (kind !== "photo" && !value("title")) throw new Error("Please enter a title.");
    if (kind === "letter" && !value("body")) throw new Error("Please write a letter.");
    const item = {
      ...current, id:id || crypto.randomUUID(), kind,
      title:value("title"), date:value("date") || null, body:value("body"),
      annual:fields.has("annual"), parent_id:value("parent_id") || null
    };
    if (kind === "letter") {
      item.letter_from = cloud ? sender : value("letter_from") === "sondos" ? "sondos" : "mostafa";
      if (!current) item.created_at = new Date().toISOString();
    }
    if (cloud && !current) item.created_by = userId;
    await save(item,file);
    dialog.close();
    await refresh();
    render();
    const parent = find(item.parent_id);
    if (dashboardOpen() && parent && file) viewItem(parent);
    notify("Saved.");
  } catch (error) {
    if (form.isConnected) note.textContent = error.message;
    else notify(error.message);
  } finally {
    button.textContent = buttonLabel;
    button.disabled = false;
    if (back) back.disabled = false;
  }
});
window.addEventListener("hashchange", () => {
  if (!opened) return;
  if (dialog.open) dialog.close();
  const managing = dashboardOpen();
  if (managing !== !main.querySelector(".landing-section")) render();
  goToSection(true);
});
window.addEventListener("scroll", updateActiveTab, {passive:true});
setInterval(tick,1000);

async function init() {
  render();
  try {
    if (!cloud) {
      if (sessionStorage.getItem("album-preview-open")) await startSession();
      return;
    }
    const url = new URL(config.supabaseUrl);
    if (url.protocol !== "https:" || !config.publishableKey) throw new Error("Enter the Supabase HTTPS project URL and publishable key in config.js.");
    await new Promise((resolve,reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.86.2/dist/umd/supabase.min.js";
      script.onload = resolve;
      script.onerror = () => reject(new Error("The Supabase library could not be loaded."));
      document.head.append(script);
    });
    api = window.supabase.createClient(url.href,config.publishableKey);
    api.auth.onAuthStateChange(event => { if (event === "SIGNED_OUT") clearSession(); });
    const session = checked(await api.auth.getSession()).session;
    loginReady = true;
    if (session) {
      try { await startSession(); }
      catch (error) {
        if (!opened) render();
        notify(error.message);
      }
    } else {
      const button = document.querySelector('#login button[type="submit"]');
      button.textContent = "Continue";
      button.disabled = false;
    }
  } catch (error) {
    if (cloud) {
      loginUnavailable = true;
      render();
    } else {
      notify(error.message);
    }
  }
}
init();
