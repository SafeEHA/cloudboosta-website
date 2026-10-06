/* Cloudboosta · single sources of truth for the marketing site.
   Edit values here; pages render from them. Carried over from the previous
   site's /v4/js/config.js so nothing that was configurable stops being so. */

window.CB = window.CB || {};

CB.cohort = {
  enrolmentCloses: "27 June 2026",
  enrolmentClosesISO: "2026-06-27T23:59:59",
  startDate: null,                          // CLIENT TO PROVIDE
  seatCap: 20,
  seatsLeft: 11,                            // wire to CMS / live source pre-launch
  discountDeadline: null,                   // CLIENT TO PROVIDE
};

CB.pricing = {
  single:  1350,    // any one 8-week pathway
  bundle2: 2400,    // 2 pathways / 16 weeks
  three:   3450,    // 3 pathways / 24 weeks
  four:    4500,    // 4 pathways / 32 weeks
  splitSurcharge2: 100,
  splitSurcharge3: 200,
};

CB.fx = {
  GBP: { rate: 1,    symbol: "£" },
  USD: { rate: 1.27, symbol: "$" },
  EUR: { rate: 1.17, symbol: "€" },
  NGN: { rate: 1900, symbol: "₦" },
};

// The discovery-call booking page: a Google Calendar appointment schedule on the
// support account (recreated 2026-08-26; the previous one had been deleted
// upstream). Every data-booking button on the site uses it. Keep it in step with
// the BOOKING_URL* variables on Netlify, which the assessment report emails use.
CB.bookingUrl = "https://calendar.app.google/ZFmVD5jZGv3KFMN6A";

// WhatsApp routing: page → { number, prefilledText }
CB.whatsapp = {
  triage:   { number: "447592233052", text: "Hi Cloudboosta, I have a question. I'm interested in: [ ] cloud services for my company [ ] the Academy [ ] something else" },
  services: { number: "447565707254", text: "Hi, I'm interested in cloud / DevOps services for my team." },
  academy:  { number: "447592233052", text: "Hi, I have a question about the Academy cohort." },
  resources:{ number: "447592233052", text: "Hi, I had a question after reading your resources." },
  whoweare: { number: "447565707254", text: "Hi, I'd like to speak to someone at Cloudboosta." },
};

CB.isWorkingHours = function () {
  const now = new Date();
  const uk = new Date(now.toLocaleString("en-GB", { timeZone: "Europe/London" }));
  const day = uk.getDay();
  const hour = uk.getHours();
  return day >= 1 && day <= 6 && hour >= 8 && hour < 20;
};

CB.waLink = function (routeKey) {
  const r = CB.whatsapp[routeKey] || CB.whatsapp.triage;
  return "https://wa.me/" + r.number + "?text=" + encodeURIComponent(r.text);
};
