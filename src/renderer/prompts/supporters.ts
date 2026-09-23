import type { Supporters } from '@shared/supporters'
import supportersJson from '../../../assets/supporters.json'

/** Who is thanked in the credits and weighted into the feed's handle bag; what they gave is not in this file. */
const supporters: Supporters = supportersJson

/** The names thanked under Donors. */
export const DONORS = supporters.donors

/** The names thanked under Playtesters. */
export const PLAYTESTERS = supporters.playtesters

/** Every supporter's name and the marbles it holds in the feed's handle bag. */
export const SUPPORTER_HANDLES = supporters.handles
