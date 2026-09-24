(function () {
  var btn = document.querySelector('.nav-toggle');
  if (!btn) return;
  btn.addEventListener('click', function () {
    var nav = btn.closest('nav');
    var open = nav.classList.toggle('nav-open');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.textContent = open ? '✕' : '☰';
  });
  document.addEventListener('click', function (e) {
    var nav = document.querySelector('nav');
    if (nav && nav.classList.contains('nav-open') && !nav.contains(e.target)) {
      nav.classList.remove('nav-open');
      btn.textContent = '☰';
      btn.setAttribute('aria-expanded', 'false');
    }
  });
}());

// Content switch: elements marked data-phase="before" show until the cutover
// date; data-phase="after" elements (hidden in the HTML) show from that date on.
// The date is evaluated in Pacific time on every page load.
(function () {
  var CUTOVER = '2026-10-03';
  var today;
  try {
    today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  } catch (e) {
    return;
  }
  if (today < CUTOVER) return;
  Array.prototype.forEach.call(document.querySelectorAll('[data-phase="before"]'), function (el) { el.hidden = true; });
  Array.prototype.forEach.call(document.querySelectorAll('[data-phase="after"]'), function (el) { el.hidden = false; });
}());
