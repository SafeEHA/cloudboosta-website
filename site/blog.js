/* Blog index — client-side category filter and search. The site is static, so
   the old /blog?category=…&search=… links resolve here instead of on a server.
   Nothing is hidden until the reader acts, and the URL keeps their choice. */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var form = $('.filters'), input = $('#search'), pills = $$('.pill'), posts = $$('[data-post]');
  var empty = $('[data-empty]'), featured = $('.featured');
  if (!form || !posts.length) return;

  var category = '', query = '';

  function apply() {
    var q = query.trim().toLowerCase(), shown = 0;
    posts.forEach(function (el) {
      var okCat = !category || el.getAttribute('data-category') === category;
      var okQ = !q || (el.getAttribute('data-text') || '').toLowerCase().indexOf(q) !== -1;
      var on = okCat && okQ;
      el.hidden = !on; if (on) shown += 1;
    });
    if (featured) featured.hidden = !!$('[data-post]:not([hidden])', featured) === false;
    if (empty) empty.hidden = shown !== 0;
    pills.forEach(function (p) {
      var on = (p.getAttribute('data-category') || '') === category;
      p.classList.toggle('is-active', on); p.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    var url = new URL(window.location.href);
    if (category) url.searchParams.set('category', category); else url.searchParams.delete('category');
    if (q) url.searchParams.set('search', query.trim()); else url.searchParams.delete('search');
    window.history.replaceState(null, '', url.pathname + url.search);
  }

  pills.forEach(function (p) {
    p.addEventListener('click', function () { category = p.getAttribute('data-category') || ''; apply(); });
  });
  if (input) input.addEventListener('input', function () { query = input.value; apply(); });
  form.addEventListener('submit', function (e) { e.preventDefault(); query = input ? input.value : ''; apply(); });

  var params = new URLSearchParams(window.location.search);
  var c = params.get('category') || '', s = params.get('search') || '';
  if (c && pills.some(function (p) { return p.getAttribute('data-category') === c; })) category = c;
  if (s && input) { input.value = s; query = s; }
  if (category || query) apply();
})();
