import type { Challenge } from '../engine/types'
import { apiRace } from './api-race'
import { authzPolicy } from './authz-policy'
import { authzStaleShare } from './authz-stale-share'
import { cryptoNonce } from './crypto-nonce'
import { designThreat } from './design-threat'
import { forensicsLog } from './forensics-log'
import { inputCanon } from './input-canon'
import { sessionFixation } from './session-fixation'

export const CHALLENGES: readonly Challenge[] = [
  authzStaleShare,
  authzPolicy,
  sessionFixation,
  inputCanon,
  apiRace,
  cryptoNonce,
  designThreat,
  forensicsLog,
]

export function getChallenge(id: string): Challenge | undefined {
  return CHALLENGES.find((c) => c.id === id)
}
