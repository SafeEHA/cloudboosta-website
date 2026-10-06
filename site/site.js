/* Cloudboosta NIGHTSHIFT — shared site behaviour. No framework. Every feature
   degrades to static markup: nothing here hides content that JS failed to show. */
(function () {
  'use strict';
  var CB = window.CB || {};
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ---- config-driven values: <span data-cb="cohort.enrolmentCloses"> ---- */
  $$('[data-cb]').forEach(function (el) {
    var path = el.getAttribute('data-cb').split('.');
    var v = CB; for (var i = 0; i < path.length && v != null; i++) v = v[path[i]];
    if (v != null && v !== '') el.textContent = String(v);
  });

  /* ---- booking links: <a data-booking> use CB.bookingUrl when set ---- */
  if (CB.bookingUrl) {
    $$('[data-booking]').forEach(function (a) {
      a.href = CB.bookingUrl; a.target = '_blank'; a.rel = 'noopener';
      if (a.hasAttribute('data-booking-text')) a.textContent = CB.bookingUrl.replace(/^https?:\/\//, '');
    });
  }

  /* ---- WhatsApp float: <a class="wa" data-wa-route="academy"> ---- */
  $$('[data-wa-route]').forEach(function (a) {
    if (CB.waLink) a.href = CB.waLink(a.getAttribute('data-wa-route'));
  });

  /* ---- mobile nav ---- */
  var burger = $('.nav-burger'), closeBtn = $('.nav-mobile-close');
  function setNav(open) {
    document.body.classList.toggle('nav-open', open);
    if (burger) burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open && closeBtn) closeBtn.focus();
  }
  if (burger) burger.addEventListener('click', function () { setNav(!document.body.classList.contains('nav-open')); });
  if (closeBtn) closeBtn.addEventListener('click', function () { setNav(false); burger && burger.focus(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setNav(false); });
  $$('.nav-links .dd > a').forEach(function (a) {
    a.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); a.parentNode.classList.toggle('is-open'); } });
  });

  /* ---- countdown: cells #cd-d/#cd-h/#cd-m/#cd-s; hidden once the date has passed ---- */
  var cdRoot = $('[data-countdown]');
  if (cdRoot) {
    var iso = cdRoot.getAttribute('data-countdown') || (CB.cohort && CB.cohort.enrolmentClosesISO);
    var deadline = iso ? new Date(iso) : null;
    var pad = function (n) { return String(Math.max(0, n)).padStart(2, '0'); };
    var tick = function () {
      if (!deadline || isNaN(deadline)) return;
      var t = deadline - new Date();
      if (t <= 0) { cdRoot.classList.add('is-expired'); return; }
      var s = Math.floor(t / 1000);
      var set = function (id, v) { var el = document.getElementById(id); if (el) el.textContent = pad(v); };
      set('cd-d', Math.floor(s / 86400)); set('cd-h', Math.floor(s % 86400 / 3600));
      set('cd-m', Math.floor(s % 3600 / 60)); set('cd-s', s % 60);
    };
    tick(); setInterval(tick, 1000);
  }

  /* ---- count-up figures: <span data-count="95" data-suffix="%"> ---- */
  var counted = false;
  function countUp() {
    if (counted) return; counted = true;
    $$('[data-count]').forEach(function (n) {
      var end = parseFloat(n.getAttribute('data-count')), suf = n.getAttribute('data-suffix') || '';
      if (reduced || isNaN(end)) { n.textContent = end + suf; return; }
      var t0 = null;
      var step = function (ts) {
        if (!t0) t0 = ts; var p = Math.min(1, (ts - t0) / 1400); var e = 1 - Math.pow(1 - p, 3);
        n.textContent = Math.round(end * e) + suf; if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  /* ---- reveal fallback where scroll-driven animations are unsupported ---- */
  var scrollDriven = window.CSS && CSS.supports && CSS.supports('animation-timeline: view()');
  if ('IntersectionObserver' in window) {
    if (!scrollDriven && !reduced) document.documentElement.classList.add('js-io');
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        en.target.classList.add('in');
        if (en.target.hasAttribute('data-count-root')) countUp();
        io.unobserve(en.target);
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.12 });
    $$('.reveal, .wipe, .unveil, [data-count-root]').forEach(function (el) { io.observe(el); });
  } else { countUp(); }

  /* ---- hero cursor parallax: #hero with #hero-img ---- */
  var hero = $('#hero'), img = $('#hero-img');
  if (hero && img && !reduced && window.matchMedia('(pointer: fine)').matches) {
    hero.addEventListener('mousemove', function (e) {
      var r = hero.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
      img.style.transition = 'transform .9s cubic-bezier(.16,1,.3,1)'; img.style.animation = 'none';
      img.style.transform = 'scale(1.06) translate3d(' + (-x * 24) + 'px,' + (-y * 16) + 'px,0)';
    });
  }

  /* ---- FAQ: <details> is native; keep one open at a time inside .faq ---- */
  $$('.faq').forEach(function (faq) {
    $$('details', faq).forEach(function (d) {
      d.addEventListener('toggle', function () {
        if (d.open) $$('details', faq).forEach(function (o) { if (o !== d) o.open = false; });
      });
    });
  });

  /* ---- detail popups: <button data-modal="id"> opens <dialog id> ---- */
  $$('[data-modal]').forEach(function (b) {
    b.addEventListener('click', function () {
      var d = document.getElementById(b.getAttribute('data-modal'));
      if (d && typeof d.showModal === 'function' && !d.open) d.showModal();
    });
  });
  $$('dialog.pm').forEach(function (d) {
    $$('.pm-close', d).forEach(function (c) { c.addEventListener('click', function () { d.close(); }); });
    d.addEventListener('click', function (e) { if (e.target === d) d.close(); }); // backdrop
    d.addEventListener('close', function () { document.body.classList.remove('modal-open'); });
    new MutationObserver(function () { document.body.classList.toggle('modal-open', d.open); })
      .observe(d, { attributes: true, attributeFilter: ['open'] });
  });

  /* ---- enrol form live total (pricing from config) ---- */
  var form = $('[data-enrol-form]');
  if (form && CB.pricing) {
    var out = $('[data-total]', form), ccy = $('[name="currency"]', form);
    // /enroll/?pathway=cc|ad|pe|sre|z2c|pro|p3|p4 pre-selects the tile the reader came from.
    var want = new URLSearchParams(window.location.search).get('pathway');
    if (want && /^[a-z0-9]{1,6}$/.test(want)) {
      var pre = form.querySelector('[name="pathway"][data-pathway="' + want + '"]');
      if (pre) pre.checked = true;
    }
    function total() {
      var pw = form.querySelector('[name="pathway"]:checked'), plan = form.querySelector('[name="plan"]:checked');
      if (!pw) { if (out) out.textContent = '·'; return; }
      // The radio's value is the pathway id (what the submission reports); the
      // price rides on data-price so the total never depends on the id.
      var base = parseFloat(pw.getAttribute('data-price')) || 0, plus = plan && plan.value === 'split2' ? CB.pricing.splitSurcharge2 : plan && plan.value === 'split3' ? CB.pricing.splitSurcharge3 : 0;
      var fx = (CB.fx && CB.fx[ccy ? ccy.value : 'GBP']) || CB.fx.GBP;
      var amount = Math.round((base + plus) * fx.rate);
      if (out) out.textContent = fx.symbol + amount.toLocaleString('en-GB');
    }
    form.addEventListener('change', total); total();
    // Back from Stripe without paying: /enroll/?cancelled=1. Nothing was
    // charged and nothing was lost; say so above the form.
    if (new URLSearchParams(window.location.search).get('cancelled') === '1') {
      var cancelled = $('[data-cancelled]', form);
      if (cancelled) cancelled.hidden = false;
    }
  }

  /* ---- site forms: <form data-form="…" action="/api/form"> post in place.
     Without JavaScript the browser posts the same fields to the same endpoint
     and lands on /thanks/ with the outcome in ?status=. ---- */
  var SUPPORT = 'support@cloudboosta.co.uk';
  var FORM_MSG = {
    rate_limited: 'Too many messages from this connection in the last hour. Try again later, or email ' + SUPPORT + '.',
    validation_failed: 'Something in the form is missing or not in the expected shape. Check the highlighted fields.',
    not_delivered: 'That didn\'t go through on our side and nothing was saved. Please email ' + SUPPORT + ' directly.',
    generic: 'That didn\'t go through. Please try again, or email ' + SUPPORT + '.'
  };
  if (window.fetch && window.FormData) $$('form[data-form]').forEach(function (f) {
    var btn = $('button[type="submit"]', f);
    var note = document.createElement('p'); note.className = 'form-status'; note.setAttribute('role', 'status'); note.hidden = true;
    f.appendChild(note);
    var say = function (text, bad) { note.textContent = text; note.hidden = !text; note.classList.toggle('is-error', !!bad); };
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var data = {};
      new FormData(f).forEach(function (v, k) { if (typeof v === 'string' && !(k in data)) data[k] = v; });
      $$('[aria-invalid]', f).forEach(function (el) { el.removeAttribute('aria-invalid'); });
      if (btn) btn.disabled = true;
      say('Sending…');
      fetch('/api/form', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data), credentials: 'same-origin' })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (b) { b.ok = r.ok; return b; }); })
        .then(function (res) {
          if (res.ok) {
            // An enrolment answers with Stripe's hosted checkout for the first
            // payment; the seat is confirmed by email once it clears.
            if (res.checkout_url && /^https:\/\/checkout\.stripe\.com\//.test(res.checkout_url)) {
              say('Taking you to secure payment…');
              window.location.assign(res.checkout_url);
              return;
            }
            var to = f.getAttribute('data-thanks');
            if (to) { window.location.assign(to); return; }
            $$('input,select,textarea,button', f).forEach(function (el) { el.disabled = true; });
            f.classList.add('is-sent');
            say(f.getAttribute('data-sent') || 'Sent. We\'ll be in touch.');
            return;
          }
          if (res.error === 'validation_failed' && res.errors) {
            res.errors.forEach(function (er) { var el = f.querySelector('[name="' + er.field + '"]'); if (el) el.setAttribute('aria-invalid', 'true'); });
          }
          say(FORM_MSG[res.error] || FORM_MSG.generic, true);
          if (btn) btn.disabled = false;
        })
        .catch(function () { say(FORM_MSG.generic, true); if (btn) btn.disabled = false; });
    });
  });

  /* ---- /thanks/: <div data-status="…"> blocks; ?status= picks one ---- */
  var alts = $$('[data-status]');
  if (alts.length) {
    var st = new URLSearchParams(window.location.search).get('status');
    if (st) {
      var hit = alts.filter(function (el) { return el.getAttribute('data-status').split(' ').indexOf(st) >= 0; })[0]
        || alts.filter(function (el) { return el.getAttribute('data-status').split(' ').indexOf('failed') >= 0; })[0];
      if (hit) { alts.forEach(function (el) { el.hidden = el !== hit; }); document.title = 'Not sent · Cloudboosta'; }
    }
  }

  /* ---- lightbox: <a href="full.jpg" data-lb data-caption="…"> opens in a <dialog> ---- */
  var lbLinks = $$('a[data-lb]');
  if (lbLinks.length && 'HTMLDialogElement' in window) {
    var lb = document.createElement('dialog'); lb.className = 'lb'; lb.setAttribute('aria-label', 'Photo');
    lb.innerHTML = '<button class="lb-close" type="button" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>'
      + '<figure class="lb-fig"><img alt=""><figcaption class="lb-cap"></figcaption><span class="lb-count"></span>'
      + '<button class="lb-btn lb-prev" type="button" aria-label="Previous"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></button>'
      + '<button class="lb-btn lb-next" type="button" aria-label="Next"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button></figure>';
    document.body.appendChild(lb);
    var lbImg = $('img', lb), lbCap = $('.lb-cap', lb), lbCount = $('.lb-count', lb), lbIndex = 0;
    var show = function (i) {
      lbIndex = (i + lbLinks.length) % lbLinks.length;
      var a = lbLinks[lbIndex], thumb = $('img', a);
      lbImg.src = a.getAttribute('href'); lbImg.alt = thumb ? thumb.alt : '';
      lbCap.textContent = a.getAttribute('data-caption') || '';
      lbCount.textContent = (lbIndex + 1) + ' / ' + lbLinks.length;
    };
    lbLinks.forEach(function (a, i) {
      a.addEventListener('click', function (e) { e.preventDefault(); show(i); if (!lb.open) lb.showModal(); document.body.classList.add('modal-open'); });
    });
    $('.lb-close', lb).addEventListener('click', function () { lb.close(); });
    $('.lb-prev', lb).addEventListener('click', function () { show(lbIndex - 1); });
    $('.lb-next', lb).addEventListener('click', function () { show(lbIndex + 1); });
    lb.addEventListener('click', function (e) { if (e.target === lb) lb.close(); });
    lb.addEventListener('close', function () { document.body.classList.remove('modal-open'); lbImg.removeAttribute('src'); });
    lb.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') show(lbIndex + 1);
      if (e.key === 'ArrowLeft') show(lbIndex - 1);
    });
  }

  /* ---- reading progress: <div class="progress"> on article pages ---- */
  var bar = $('.progress');
  if (bar) {
    var onScroll = function () {
      var doc = document.documentElement;
      var max = doc.scrollHeight - window.innerHeight;
      bar.style.transform = 'scaleX(' + (max > 0 ? Math.min(1, window.scrollY / max) : 0) + ')';
    };
    window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
  }

  /* ---- year ---- */
  $$('[data-year]').forEach(function (el) { el.textContent = String(new Date().getFullYear()); });
})();
