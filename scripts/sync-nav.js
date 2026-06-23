// Run: npm run sync:nav
// Rewrites the <nav> and <footer> in every HTML page from a single source.
// Edit NAV_LINKS or FOOTER_TEXT here, then run this script to push changes everywhere.

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const CONTACT_HREF = 'https://docs.google.com/forms/d/e/1FAIpQLSdbpyuHfnAEMRjwcA4fM1cgb75ieaa8xzXpKImt8ljRoC1WZA/viewform';

// Edit this list to change navigation across the whole site.
const NAV_LINKS = [
  { href: 'index.html',        label: 'Home' },
  { href: 'firstvisit.html',   label: 'First Visit' },
  { href: 'about.html',        label: 'About' },
  { href: 'roundrobins.html',  label: 'Round Robins' },
  { href: 'leaderboard.html',  label: 'Leaderboard' },
  { href: 'halloffame.html',   label: 'Hall of Fame' },
  { href: 'membership.html',   label: 'Membership' },
  { href: 'coaching.html',     label: 'Coaching' },
  { href: 'rules.html',        label: 'Rules' },
  { href: 'pictures.html',     label: 'Pictures' },
  { href: CONTACT_HREF,        label: 'Contact', external: true },
];

const FOOTER_TEXT = 'Concord Table Tennis Club, Walnut Creek, CA. Open since 1972. A 501(c)(3) nonprofit, sanctioned by USATT.';

const NAV_HREFS = new Set(NAV_LINKS.map(function (l) { return l.href; }));

function buildNavBlock(activeHref) {
  var links = NAV_LINKS.map(function (link) {
    var isActive = link.href === activeHref;
    var attrs = ['href="' + link.href + '"'];
    if (isActive) attrs.push('class="active"');
    if (link.external) { attrs.push('target="_blank"'); attrs.push('rel="noopener"'); }
    return '      <a ' + attrs.join(' ') + '>' + link.label + '</a>';
  });
  return '    <nav>\n' + links.join('\n') + '\n    </nav>';
}

function buildFooterBlock() {
  return '<footer>\n  ' + FOOTER_TEXT + '\n</footer>';
}

var htmlFiles = fs.readdirSync(ROOT).filter(function (f) { return f.endsWith('.html'); });
var updated = 0;
var unchanged = 0;

htmlFiles.forEach(function (filename) {
  var filePath = path.join(ROOT, filename);
  var original = fs.readFileSync(filePath, 'utf8');

  var activeHref = NAV_HREFS.has(filename) ? filename : null;
  var newNav = buildNavBlock(activeHref);
  var newFooter = buildFooterBlock();

  var result = original
    .replace(/<nav>[\s\S]*?<\/nav>/, newNav)
    .replace(/<footer>[\s\S]*?<\/footer>/, newFooter);

  if (result === original) {
    unchanged++;
    return;
  }

  fs.writeFileSync(filePath, result);
  console.log('Updated:', filename, activeHref ? '(active: ' + activeHref + ')' : '(no active)');
  updated++;
});

console.log('\nDone. ' + updated + ' file(s) updated, ' + unchanged + ' unchanged.');
if (updated === 0) {
  console.log('(If you expected changes, check that <nav> and <footer> tags are on their own lines.)');
}
