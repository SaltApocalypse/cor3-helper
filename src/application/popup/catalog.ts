/** Presentation-facing re-exports of stable market/job/drone definitions. */
export { JOB_MARKETS, jobMarketByKey } from '../../domains/jobs/markets.js';
export { JOB_TYPES, type JobOffer } from '../../domains/jobs/model.js';
export { DRONE_EXPEDITION_PROFILE, MERC_EXPEDITION_PROFILES, mercProfileKeyForMarket } from '../expeditions/view.js';
export { droneRefreshDelayMs } from '../../domains/drone/model.js';
