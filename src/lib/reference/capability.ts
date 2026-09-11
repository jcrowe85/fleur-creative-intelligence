// "Start smart" seed priors.
//
// A brand-new creator has no swipe history, so the feed would otherwise open on
// whatever the gap-weighting favours — which is often the advanced,
// hard-to-produce competitor work. These seeds bias a fresh feed toward phone /
// UGC content (what the jointrybe roster actually makes) and away from studio /
// animation. Learned affinity from real swipes is added ON TOP and can overcome
// these over time, so an invited animator who keeps saving advanced work is
// promoted automatically — no questionnaire.
//
// Values are rough log-odds nudges, summed across a card's attributes. Negative
// = show less to a fresh creator; positive = show more.

export const SEED_AFFINITY: Record<string, Record<string, number>> = {
  production: {
    ugc_native: 0.3, // the bread and butter — a small boost
    screen_capture: 0,
    mixed: -0.3,
    polished_studio: -1.5,
    animated: -2.0,
  },
  format: {
    talking_head_ugc: 0.5,
    text_on_screen: 0.3,
    routine_demo: 0.2,
    street_interview: 0.2,
    founder_piece: 0.1,
    expert_explainer: 0,
    static_image: 0,
    review_montage: -0.3,
    voiceover_broll: -0.5, // needs b-roll + editing
    split_screen: -0.5,
    before_after_montage: -0.5,
    product_macro: -1.5, // macro gear / setup
    animation_motion: -2.0, // can't make it on a phone
  },
};

/** Attributes we learn a per-value preference for from swipes. */
export const AFFINITY_ATTRS = ["production", "format", "pillar", "hook", "persona"] as const;
export type AffinityAttr = (typeof AFFINITY_ATTRS)[number];

/** How hard learned preference (from swipes) counts vs the seed. High enough
 *  that a few genuine saves of an "advanced" type can overcome its seed penalty
 *  and promote the creator into that content. */
export const LEARNED_WEIGHT = 2.0;

/** Laplace-style smoothing so one stray swipe doesn't swing a whole attribute. */
export const AFFINITY_SMOOTHING = 2;

export const seedAffinity = (attr: string, value: string): number =>
  SEED_AFFINITY[attr]?.[value] ?? 0;
