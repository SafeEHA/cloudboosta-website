# Cloudboosta website (static copy)

A copy of the public content of www.cloudboosta.com, taken on 6 October 2026 for local work.
It is **not** connected to the live site: nothing here deploys anywhere, and changes made here
do not reach www.cloudboosta.com.

## What is in it

The pages, styles, images, fonts and browser scripts, exactly as the live site serves them.

## What is not

- The server side: the assessment scoring endpoint, the forms, webinar registration, payments
  and the analytics endpoint (`/api/assess`, `/api/form`, `/api/webinar`, `/api/event`). Pages
  that post to them will show their error state here.
- The back-office pages (`/studio/`, `/review/`).
- Any configuration, keys, database code or tests.
- The security headers, which the live site sets at the host rather than in these files.

## Running it

Pages use root paths such as `/site/site.css`, so open them through a local web server from
this folder, not by double-clicking a file:

```
npx serve .
```

or

```
python -m http.server 8080
```

then visit http://localhost:3000 (serve) or http://localhost:8080 (Python).
