/* /webinars/register/ — fetch the current webinar from /api/webinar, render it, run the
   countdown, and post registrations. Neither state shows until the answer is
   in (webinar-boot.js); a fetch failure degrades to a truthful "not open yet". */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var live = $('[data-when="live"]');
  var none = $('[data-when="none"]');
  var w = function (name) { return $('[data-w="' + name + '"]'); };

  function countdown(iso) {
    var root = w('countdown');
    if (!root) return;
    var cells = {
      d: $('[data-cdw="d"]', root), h: $('[data-cdw="h"]', root),
      m: $('[data-cdw="m"]', root), s: $('[data-cdw="s"]', root)
    };
    var end = new Date(iso).getTime();
    if (isNaN(end)) return;
    var tick = function () {
      var left = end - Date.now();
      if (left <= 0) { root.hidden = true; clearInterval(timer); return; }
      var sec = Math.floor(left / 1000);
      cells.d.textContent = Math.floor(sec / 86400);
      cells.h.textContent = Math.floor((sec % 86400) / 3600);
      cells.m.textContent = Math.floor((sec % 3600) / 60);
      cells.s.textContent = sec % 60;
    };
    var timer = setInterval(tick, 1000);
    tick();
    root.hidden = false;
  }

  /* The parts of the start time, in the webinar's own zone. Separate date and
     time because the page shows them as separate facts. */
  function whenParts(iso, tz) {
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return null;
      var parts = {};
      new Intl.DateTimeFormat('en-GB', {
        timeZone: tz || 'Europe/London', weekday: 'long', day: 'numeric',
        month: 'long', hour: 'numeric', minute: '2-digit', hour12: true
      }).formatToParts(d).forEach(function (p) { parts[p.type] = p.value; });
      return {
        date: parts.weekday + ' ' + parts.day + ' ' + parts.month,
        time: parts.hour + ':' + parts.minute + ' ' + (parts.dayPeriod || '').toUpperCase()
      };
    } catch (e) { return null; }
  }

  /* The same instant on the visitor's own clock, or null when it would only
     repeat the UK time. Most of this audience is not in the UK. */
  function localTime(iso, tz) {
    try {
      var d = new Date(iso);
      var opts = { hour: 'numeric', minute: '2-digit', hour12: true };
      var mine = new Intl.DateTimeFormat('en-GB', opts).format(d);
      opts.timeZone = tz || 'Europe/London';
      var theirs = new Intl.DateTimeFormat('en-GB', opts).format(d);
      return mine === theirs ? null : mine.toUpperCase();
    } catch (e) { return null; }
  }

  /* "Topic: what you will do" reads as a headline and a line under it, which is
     how the flyer sets it too. No colon, no split. */
  function splitTitle(title) {
    var at = String(title).indexOf(': ');
    if (at < 12) return { main: title, sub: '' };
    return { main: title.slice(0, at), sub: title.slice(at + 2) };
  }

  function show(name, text) {
    var el = w(name);
    if (!el || !text) return false;
    el.textContent = text;
    el.hidden = false;
    return true;
  }

  function render(data) {
    if (!data || !data.id) return;
    document.title = data.title + ' · Cloudboosta Webinar';
    var title = splitTitle(data.title);
    w('title').textContent = title.main;
    show('subtitle', title.sub);
    if (data.summary) w('summary').textContent = data.summary;

    var when = data.starts_at ? whenParts(data.starts_at, data.timezone) : null;
    if (when) {
      w('date').textContent = when.date;
      w('date-row').hidden = false;
      w('time').textContent = when.time + ' UK time';
      w('time-row').hidden = false;
      var mine = localTime(data.starts_at, data.timezone);
      if (mine) show('local-time', mine + ' where you are');
    }
    w('where').textContent = data.platform ? 'Live on ' + data.platform : 'Live online';
    if (data.duration_minutes) {
      w('length').textContent = data.duration_minutes + ' minutes, with live Q&A';
      w('length-row').hidden = false;
    }

    var name = data.speaker_name || '';
    var photo = data.speaker_photo_path ? '/api/webinar?photo=1' : '';
    if (photo && name) {
      var img = w('portrait');
      img.src = photo;
      img.alt = name + (data.speaker_role ? ', ' + data.speaker_role : '');
      w('portrait-name').textContent = name;
      w('portrait-role').textContent = data.speaker_role || '';
      w('portrait-wrap').hidden = false;
    } else if (data.flyer_path) {
      var flyer = w('flyer');
      flyer.src = '/api/webinar?flyer=1';
      flyer.alt = 'Flyer: ' + data.title;
      w('flyer-wrap').hidden = false;
    }

    /* The bio section needs words; a photo alone is already in the hero. */
    var bio = String(data.speaker_bio || '').split(/\n\s*\n/)
      .map(function (p) { return p.trim(); }).filter(Boolean);
    if (name && bio.length) {
      w('bio-name').textContent = name;
      show('bio-role', data.speaker_role);
      var box = w('bio');
      bio.forEach(function (para) {
        var p = document.createElement('p');
        p.className = 'body';
        p.textContent = para;
        box.appendChild(p);
      });
      if (photo) {
        var bimg = w('bio-photo');
        bimg.src = photo;
        bimg.alt = name;
        w('bio-photo-wrap').hidden = false;
      }
      w('speaker-section').hidden = false;
      var more = w('portrait-more');
      if (more) more.hidden = false;
    }

    var agenda = Array.isArray(data.agenda) ? data.agenda : [];
    if (agenda.length) {
      var ul = w('agenda');
      agenda.forEach(function (item) {
        var li = document.createElement('li');
        if (item && typeof item === 'object') {
          var b = document.createElement('b'); b.textContent = item.title || '';
          li.appendChild(b);
          li.appendChild(document.createTextNode(item.detail || ''));
        } else {
          li.textContent = String(item);
        }
        ul.appendChild(li);
      });
      w('agenda-section').hidden = false;
    }
    if (data.starts_at) countdown(data.starts_at);
    none.hidden = true;
    live.hidden = false;
    /* site.js's reveal observer ran before this content existed; show it directly */
    Array.prototype.forEach.call(live.querySelectorAll('.reveal, .wipe'), function (el) {
      el.classList.add('in');
    });
  }

  /* Whatever the answer - a webinar, none, or no answer at all - the page stops
     being undecided here. The timer is for a request that simply hangs. */
  var root = document.documentElement;
  var decided = function () { root.classList.remove('w-pending'); };
  var giveUp = setTimeout(decided, 4000);

  fetch('/api/webinar', { credentials: 'same-origin' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(render)
    .catch(function () { /* falls through to the "none" state */ })
    .then(function () { clearTimeout(giveUp); decided(); });

  /* registration: same UX contract as the site's other forms */
  var form = $('form[data-webinar-form]');
  if (form && window.fetch) {
    var btn = $('button[type="submit"]', form);
    var note = document.createElement('p');
    note.className = 'form-status'; note.setAttribute('role', 'status'); note.hidden = true;
    form.appendChild(note);
    var say = function (text, bad) {
      note.textContent = text; note.hidden = !text;
      note.classList.toggle('is-error', !!bad);
    };
    var MSG = {
      rate_limited: 'Too many attempts from this connection. Try again in an hour, or email support@cloudboosta.co.uk.',
      validation_failed: 'Check your name and email - one of them is missing or not in the expected shape.',
      no_webinar: 'Registration just closed. The recordings page has every past session.',
      not_saved: 'That didn\'t save on our side. Please try again, or email support@cloudboosta.co.uk.',
      generic: 'That didn\'t go through. Please try again, or email support@cloudboosta.co.uk.'
    };
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var data = {};
      new FormData(form).forEach(function (v, k) { if (typeof v === 'string' && !(k in data)) data[k] = v; });
      if (btn) btn.disabled = true;
      say('Saving your seat…');
      fetch('/api/webinar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
        credentials: 'same-origin'
      })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (b) { b.ok = r.ok && b.ok !== false; return b; }); })
        .then(function (res) {
          if (res.ok) {
            say('');
            form.classList.add('is-sent');
            w('done').hidden = false;
            return;
          }
          if (res.error === 'validation_failed' && res.errors) {
            res.errors.forEach(function (er) {
              var el = form.querySelector('[name="' + er.field + '"]');
              if (el) el.setAttribute('aria-invalid', 'true');
            });
          }
          say(MSG[res.error] || MSG.generic, true);
          if (btn) btn.disabled = false;
        })
        .catch(function () { say(MSG.generic, true); if (btn) btn.disabled = false; });
    });
  }
})();
