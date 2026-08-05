/**
 * Google reviews shown on the portal's "Google Reviews" tab.
 *
 * SNAPSHOT, not live: transcribed verbatim from the public Google listing on
 * 2026-07-25 (5.0 · 22 reviews). Google blocks iframing its reviews surface,
 * and the operator chose hard-coded copies over a Places API integration —
 * so when the listing changes materially (new standout review, rating/count
 * moves), update RATING/REVIEW_COUNT and this list by hand.
 *
 * Rules for this file:
 *  - Verbatim text only — never paraphrase, "improve", or invent a review.
 *  - `truncated: true` where Google's own snippet ended in "… More"; the card
 *    renders an ellipsis + a "Read the full review on Google" link instead of
 *    pretending we have the whole text.
 *  - Owner replies are included where they exist (they demonstrate the
 *    follow-up behaviour cold visitors doubt most).
 *  - `photos`: filenames under /public/reviews/ (e.g. "hongdi-1.jpg"). The
 *    card shows a Google-style photo strip when present. Drop the image files
 *    in public/reviews/ and list them here — nothing renders for a review
 *    until its files exist.
 */

export interface GoogleReview {
  author: string;
  /** Google's relative label at snapshot time, shown verbatim. */
  when: string;
  /** All current reviews are 5★ (the listing sits at 5.0). */
  rating: number;
  text: string;
  /** True when the source snippet ended in "… More" (we don't have the rest). */
  truncated?: boolean;
  ownerReply?: string;
  /** Filenames under /public/reviews/ for this review's photo strip. */
  photos?: string[];
}

/** Listing header numbers at snapshot time. */
export const GOOGLE_RATING = 5.0;
export const GOOGLE_REVIEW_COUNT = 22;

export const GOOGLE_REVIEWS: GoogleReview[] = [
  {
    author: "hongdi chen",
    when: "8 months ago",
    rating: 5,
    text: "We're very happy with the build of our new showroom. The quality of the workmanship is excellent, and the team carried themselves with real professionalism from start to finish. Their attention to detail shows in every part of the space. A special thanks to Craig for his prompt responses, clear communication, and well-organised coordination. The entire process came together smoothly, and we're very pleased with the final result.",
    ownerReply:
      "Hi Hongdi, thank you for the kind words and thoughtful feedback. It was a pleasure working with you on the new showroom. We're glad to hear the quality and detail met your expectations, and we'll be sure to pass on your thanks to Craig and the team. We appreciate your trust in APMG Services and look forward to working together again in the future.",
    // Drop the showroom photos into public/reviews/ and list them here, e.g.:
    // photos: ["hongdi-1.jpg", "hongdi-2.jpg", "hongdi-3.jpg", "hongdi-4.jpg"],
  },
  {
    author: "Meekee Dee",
    when: "4 years ago",
    rating: 5,
    text: "Engaged services back in April to renovate and do a complete fit out for our new medical practice in Brighton. We are beyond pleased with the service, quality and reliability of this company. They worked with us and accommodated all our",
    truncated: true,
    ownerReply:
      "Thanks, Meekee! We're beyond pleased to hear how happy you are with your medical practice fit-out. It was a pleasure working with you, and we're glad we could accommodate your needs every step of the way. Craig and the team take pride in delivering quality, reliable service, and it's fantastic to know that stood out. Appreciate your high recommendation, and we'd love to help again in the future!",
    // photos: ["meekee-1.jpg", "meekee-2.jpg", "meekee-3.jpg", "meekee-4.jpg", "meekee-5.jpg"],
  },
  {
    author: "Tania Ruscoe",
    when: "5 months ago",
    rating: 5,
    text: "APMG have just completed painting the exterior of my old weatherboard house. We are very impressed with the results and we will engage with them again to paint the interior later in the year. The team were wonderful to work with. We recommend them highly.",
  },
  {
    author: "Alastair Stewart",
    when: "5 months ago",
    rating: 5,
    text: "The team arrived on time and brought their A game to a challenging job with cornices and textured plaster. Courteous, responsive, going above and beyond with a quote that sat in the mid range. Happy to recommend APMG painting when you need a balance of excellent quality and value for money.",
    ownerReply:
      "Hi Alastair Stewart, thank you so much for your kind words. We're really pleased to hear that our team delivered the level of quality, care, and professionalism you expected especially on a job with those extra challenges. We truly appreciate your recommendation and are glad we could offer a balance of quality and value that worked for you. Thanks again for choosing APMG Painting we look forward to helping you again in the future. The APMG Services Team",
  },
  {
    author: "Ben Northey",
    when: "7 months ago",
    rating: 5,
    text: "Farbod and the team did a great job on our external house painting. They helped us with colour choices and I was particularly impressed with the pre-painting prep work where they replaced some older weatherboards and patched very",
    truncated: true,
    ownerReply:
      "Hi Ben. Thanks so much for the kind words. We're really glad you were happy with the colour support, prep work, and overall finish. We appreciate your flexibility through the rainy period and will follow through on that bubbling as promised. The crew enjoyed working on your home, and we're pleased the result made a great impression. Thanks again for trusting APMG.",
  },
  {
    author: "Michael Bauer",
    when: "a month ago",
    rating: 5,
    text: "Sepi did a marvelous job restoring and painting our living and dining room walls ceilings. We're very happy with the standard of workmanship and the cost was very reasonable.",
  },
  {
    author: "Alan Lee",
    when: "7 months ago",
    rating: 5,
    text: "I have had APMG do the painting for several of my projects now. From multi units to custom architecturally designed homes, they have always done a fantastic job. Generally prompt, good quality and professional. Always a painter I can rely on!",
    ownerReply:
      "Hey Alan, thank you for your continued support and trust in APMG across multiple builds. We value great working relationships and look forward to supporting your next one.",
  },
  {
    author: "Craig Fry",
    when: "a year ago",
    rating: 5,
    text: "We just had our entire exterior house in bayside Parkdale painted by APMG Services, including weatherboard repair / replace, outside timber decks restored, and pergola laser light cleaning and screws replaced. From quote by Farbod to",
    truncated: true,
    ownerReply:
      "Thank you for your kind words, Craig. We appreciate you taking the time to share your experience. It was a pleasure working on your home, and we're glad to hear you were happy with the quality of work and service from Rey and the team. Delivering thorough, high-standard work is what we strive for, so it's great to know we met your expectations. Thanks again for your recommendation—we're always here if you need anything in the future.",
  },
  {
    author: "Joe Mariniello",
    when: "a year ago",
    rating: 5,
    text: "Needed some carpentry work and the outside of my house repainted. Could not be happier with the quality of work performed by the guys at APMG. They all take a lot of pride in their work taking great care in what they did and their attention",
    truncated: true,
    ownerReply:
      "Thanks so much, Joe! We're thrilled to hear you're happy with the carpentry and painting work from our team. Spot on—at APMG, we take pride in what we do, delivering quality workmanship with great attention to detail at a fair and reasonable cost. It's fantastic to know that stood out to you! We really appreciate your recommendation, and if you ever need any more property maintenance, give us a shout! 👍🏼🏡🎨",
  },
  {
    author: "Neil Cowen",
    when: "a year ago",
    rating: 5,
    text: "The quality of the preparation and our external walls and painting was excellent. The painters communicated well, were friendly and respectful and didn't leave any mess behind. Very flexible",
    ownerReply:
      "Thank you for your kind words, Neil! We're glad you're happy with the quality of the prep and painting from our team. At APMG, we take pride in our work, and it's great to hear our communication and attention to detail stood out. We appreciate your support, and if you ever need further maintenance in the future—whether it's carpentry, plumbing, electrical work, or more—we'd love to help again! 👍🏼🏡",
  },
  {
    author: "Shaun Fielder",
    when: "2 years ago",
    rating: 5,
    text: "We had exterior painting done after cladding repairs. The entire process - from quoting to finish - demonstrated care and attention to",
    truncated: true,
    ownerReply:
      "Thanks, Shaun! We're so pleased to hear you were thrilled with the results. Blade and the team take great pride in our work, and it's fantastic to know our care and attention to detail stood out. We appreciate your trust in APMG and would be happy to help with any future projects! 👍🏼🎨🏡",
  },
  {
    author: "Rob Manfredi",
    when: "a year ago",
    rating: 5,
    text: "Our clients recently engaged Farbod and the team at APMG to provide a service. APMG were fantastic to deal with. Farbod was a great communicator and the works were completed timely and as quoted. Farbod made my role as the manager of the building and overseeing the works a pleasure.. Highly recommend.",
    ownerReply:
      "Thanks so much, Rob! We're delighted to hear that you and your clients had a great experience with Farbod and the team. At APMG, we pride ourselves on clear communication, timely service, and delivering exactly as quoted. Glad we could make your job easier—appreciate the recommendation!",
  },
  {
    author: "Carmel Spano",
    when: "3 years ago",
    rating: 5,
    text: "I needed a carpenter to repair my verandah and Matt was so professional and completed the job to the utmost perfection!. Their prices are very competitive, in fact cost me half the price that others quoted for the same job. I would highly",
    truncated: true,
    ownerReply:
      "Thanks, Carmel! We're thrilled to hear Matt delivered top-notch work on your verandah. Providing professional service at a fair price is what we're all about! Appreciate your high recommendation, and we'd be more than happy to help with any future home maintenance needs. 👍🏼🔨🏡",
  },
  {
    author: "Sofia Alexiou",
    when: "2 years ago",
    rating: 5,
    text: "Farbod and his team painted our home inside and out and did a wonderful job. Extremely professional and reliable. They also repaired a leak that no one else was able to. Highly rated.",
    ownerReply:
      "Thanks, Sofia! We're so glad you're happy with the painting and repairs. Farbod and the team take pride in delivering professional, reliable service, and it's great to hear we could solve that tricky leak for you! Appreciate the high rating and your support. If you ever need any work done in the future, feel free to reach out anytime! 👍🏼🎨🔧🏡",
  },
  {
    author: "Rapidline",
    when: "2 years ago",
    rating: 5,
    text: "Farbod and Mason were great to work with. Farbod responded to any concerns and issues quickly while Mason did a great job painting and tidying up the walls in our Showroom. Thanks APMG!",
    ownerReply:
      "We're glad to hear Farbod and Mason provided great service and took care of your showroom. Quick responses and quality workmanship are what we strive for! If you ever need any additional work, give us a shout—we'd love to help again! 👍🏼🎨🏢",
  },
  {
    author: "Shelley Morris",
    when: "3 years ago",
    rating: 5,
    text: "Blade did a fantastic job painting my bathroom & other touch ups. They were easy to contact & came when they said they would. Highly recommended this company.",
    ownerReply:
      "Thanks, Shelley! We're so glad you're happy with the painting and touch-ups. Blade and the team take pride in being reliable and delivering quality work. Appreciate your recommendation, and if you ever need anything else, we're here to help! 👍🏼🎨🔧",
  },
  {
    author: "Win R",
    when: "2 years ago",
    rating: 5,
    text: "It was a really great experience from the team from start to end, especially Craig and Paul. Very professional service highly recommended to anyone that is looking for a handyman :)",
    ownerReply:
      "Thanks, Win! We're so glad you had a great experience with Craig, Paul, and the team from start to finish. We take pride in delivering professional and reliable service, and it's great to know that stood out. Appreciate the recommendation! If you're ever needing anything else, give us a shout! 👍🏼🔧🏡",
  },
  {
    author: "Jen B",
    when: "a year ago",
    rating: 5,
    text: "I am very pleased with the workmanship displayed by Rowan. The pantry he built looks great!",
    ownerReply:
      "Thank you, Jen! Glad to hear you're happy with Rowan's workmanship. Enjoy your new pantry, and give us a shout if we can help with anything else! 😊🔨",
  },
  {
    author: "alison hart",
    when: "a year ago",
    rating: 5,
    text: "Very happy with communication, punctuality, standard of work and value for money. Would recommend.",
    ownerReply:
      "Thanks, Alison! We're so glad you're happy with our communication, punctuality, and quality of work. Providing great service at a fair price is what we're all about! Appreciate the recommendation. 👍🏼🔨🏡",
  },
  {
    author: "Nick Yang",
    when: "2 years ago",
    rating: 5,
    text: "Renovated our clinic, did a great job, highly recommended",
    ownerReply:
      "Thanks, Nick! We're glad to hear you're happy with your clinic renovation. It was a pleasure working on the project! Appreciate the recommendation, and if you ever need anything else, we're here to help. 👍🏼🔨🏢",
  },
];
