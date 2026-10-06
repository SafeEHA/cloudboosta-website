/* /webinars/register/ - runs in <head>, before anything paints.

   The page has two states, "a webinar is open" and "none is", and only
   /api/webinar knows which. It used to ship with "none" visible and swap once
   the answer arrived, so every visitor to a live webinar saw "The next one is
   being scheduled" for a split second first. This marks the document as
   undecided so webinar.css can hold both states back; webinar.js clears it
   the moment it knows.

   It lives in a file because the CSP allows no inline script. With scripts
   off the class is never set, and the honest "none" state shows as before. */
document.documentElement.classList.add('w-pending');
