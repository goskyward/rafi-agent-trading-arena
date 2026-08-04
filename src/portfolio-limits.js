import { ARENA_CONFIG } from "./config.js";
import { ArenaError } from "./utils.js";
export function validatePortfolioEntry(account,productId){if(account.positions?.[productId])throw new ArenaError("DUPLICATE_PRODUCT_POSITION","An agent may hold only one position per product.",409);if(Object.keys(account.positions||{}).length>=ARENA_CONFIG.maximumOpenPositions)throw new ArenaError("MAXIMUM_POSITIONS_REACHED",`An agent may hold at most ${ARENA_CONFIG.maximumOpenPositions} positions.`,409);return true;}
