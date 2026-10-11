// Joint angles for the walking avatar, as plain numbers (no 3D library), so the movement can be tested. Angles are in radians.
// Conventions: hips, shoulders and spine flex forward when positive; knees and elbows bend (positive); the figure faces +Z and stands on Y = 0.

import type { Gait, Intent } from './avatar-mind.ts'

export interface Pose {
  rootY: number; rootRoll: number; rootYaw: number
  spineFlex: number; chestTwist: number; chestBreath: number
  neckFlex: number; headYaw: number; headPitch: number
  hipL: number; hipR: number; hipAbdL: number; hipAbdR: number; kneeL: number; kneeR: number; ankleL: number; ankleR: number
  shoulderL: number; shoulderR: number; abdL: number; abdR: number; elbowL: number; elbowR: number
  /** 0 open .. 1 closed */
  lid: number
  gazeYaw: number; gazePitch: number
}

export interface MotionState {
  intent: Intent
  gait: Gait
  /** gait phase in radians; the caller advances it by 2*pi*cycle*dt while moving */
  phase: number
  /** seconds since the app started: drives idle sway, breathing, blinking */
  t: number
  /** 0 standing .. 1 seated */
  sit: number
  /** 0..1 how far into a stretch the avatar is */
  stretch: number
  /** -1..1 sweep of a look-around */
  look: number
  breathRpm: number
  breathDepth: number
  /** 0..1 how worn out the avatar is, which lowers the eyelids and rounds the back */
  fatigue: number
  tremor: number
  strengthL: number
  strengthR: number
}

export const LEG = 0.88          // hip to ankle, metres (the figure's leg length)

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x))
const ease = (x: number) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t) }

/** Peak thigh swing for a given speed and gait rate so that the mean foot speed on the ground equals the body speed (no skating). */
export function swingAmplitude(speed: number, cycle: number): number {
  if (speed <= 0 || cycle <= 0) return 0
  const stepLength = speed / (2 * cycle)
  return Math.asin(clamp(stepLength / (2 * LEG), 0, 0.85))
}

/** A blink about every 4 s, lasting 0.16 s; slightly more often when tired. */
export function blinkAt(t: number, fatigue: number): number {
  const period = 4.2 - fatigue * 1.2
  const x = (t % period) / 0.16
  return x < 1 ? Math.sin(Math.PI * x) : 0
}

export function computePose(s: MotionState): Pose {
  const g = s.gait, moving = g.moving && s.sit < 0.5
  const run = clamp((g.speed - 1.6) / 2.6, 0, 1), walkish = moving ? 1 : 0
  const theta = swingAmplitude(g.speed, g.cycle) * walkish
  const ph = s.phase
  const sL = Math.sin(ph), sR = Math.sin(ph + Math.PI), cL = Math.cos(ph), cR = Math.cos(ph + Math.PI)

  // idle life: slow weight shift and breathing
  const breath = Math.sin((2 * Math.PI * s.breathRpm * s.t) / 60)
  const sway = Math.sin(s.t * 0.35) * (1 - walkish)
  const trem = s.tremor * (Math.sin(s.t * 38) * 0.5 + Math.sin(s.t * 53) * 0.5)

  // legs: the thigh swings by theta; the knee bends while the leg swings forward (cos > 0) and a little on landing
  const swingFlex = (c: number, sn: number) => walkish * (Math.max(0, c) ** 1.3 * (0.35 + 0.95 * run) + Math.max(0, -sn) * 0.1)
  let hipL = theta * sL * s.strengthL, hipR = theta * sR * s.strengthR
  let kneeL = swingFlex(cL, sL) + 0.03, kneeR = swingFlex(cR, sR) + 0.03
  let ankleL = -hipL * 0.5 + kneeL * 0.25, ankleR = -hipR * 0.5 + kneeR * 0.25

  // arms swing against the legs; the elbows bend more the faster the pace
  const armA = 0.5 * g.swing * (moving ? 1 : 0)
  let shoulderL = -armA * sL * s.strengthL, shoulderR = -armA * sR * s.strengthR
  const elbowBase = 0.12 + 0.2 * (moving ? 1 : 0) + run * 1.1
  let elbowL = elbowBase + (moving ? 0.35 * Math.max(0, -sL) * (0.5 + run) : 0), elbowR = elbowBase + (moving ? 0.35 * Math.max(0, -sR) * (0.5 + run) : 0)
  let abdL = 0.07, abdR = 0.07

  // trunk and head
  let spineFlex = g.lean + g.slump * 0.3 + s.fatigue * 0.05
  let neckFlex = -g.lean * 0.6 + g.slump * 0.35
  let headYaw = 0, headPitch = 0
  let rootY = -(moving ? 0.022 * (g.speed / 1.3) ** 0.8 + 0.03 * run : 0) * (0.5 + 0.5 * Math.cos(2 * ph)) - g.slump * 0.012
  const rootRoll = moving ? 0.03 * cL : sway * 0.02
  const rootYaw = moving ? 0.1 * sL * (0.5 + run) : 0
  const chestTwist = moving ? -0.14 * sL * (0.5 + run * 0.8) : 0

  // sitting: thighs forward, shins down, hips lowered onto a seat
  const sit = ease(s.sit)
  if (sit > 0) {
    hipL += (1.5 - hipL) * sit; hipR += (1.5 - hipR) * sit; kneeL += (1.5 - kneeL) * sit; kneeR += (1.5 - kneeR) * sit
    ankleL += (-0.2 - ankleL) * sit; ankleR += (-0.2 - ankleR) * sit
    shoulderL += (0.35 - shoulderL) * sit; shoulderR += (0.35 - shoulderR) * sit; elbowL += (1.1 - elbowL) * sit; elbowR += (1.1 - elbowR) * sit
    rootY = rootY * (1 - sit) - 0.4 * sit; spineFlex += 0.12 * sit; neckFlex += 0.05 * sit
  }

  // stretching: arms up and apart, back arched, head tipped back
  const st = Math.sin(Math.PI * clamp(s.stretch, 0, 1)) ** 0.7
  if (st > 0) { abdL += (2.9 - abdL) * st; abdR += (2.9 - abdR) * st; elbowL *= 1 - st * 0.9; elbowR *= 1 - st * 0.9; spineFlex -= 0.18 * st; neckFlex -= 0.25 * st }

  // looking around: the head leads, the eyes lead the head
  headYaw = s.look * 0.9; const gazeYaw = s.look * 1.1
  headPitch = -0.05 + Math.sin(s.t * 0.5) * 0.04 * (1 - walkish) + g.slump * 0.1

  const lid = clamp(blinkAt(s.t, s.fatigue) + s.fatigue * 0.35, 0, 1)
  return {
    rootY, rootRoll, rootYaw, spineFlex: spineFlex + trem * 0.02, chestTwist, chestBreath: breath * s.breathDepth,
    neckFlex, headYaw, headPitch,
    hipL: hipL + trem * 0.02, hipR: hipR + trem * 0.02, hipAbdL: 0.03 + sway * 0.03, hipAbdR: 0.03 - sway * 0.03, kneeL, kneeR, ankleL, ankleR,
    shoulderL: shoulderL + trem * 0.04, shoulderR: shoulderR + trem * 0.04, abdL, abdR, elbowL: elbowL + trem * 0.03, elbowR: elbowR + trem * 0.03,
    lid, gazeYaw, gazePitch: -0.03,
  }
}

// ---- moving through the room -------------------------------------------------------------------------------------------------------------
export interface WorldState {
  x: number; z: number
  /** heading in radians about the vertical axis; the figure faces (sin h, cos h) */
  heading: number
  phase: number
  sit: number
  stretch: number
  look: number
  goal: { x: number; z: number } | null
  /** which intent the goal and stretch belong to, so they reset when the choice changes */
  forIntent: Intent | null
  lookDir: 1 | -1
}

/** The stool the avatar walks to when it wants to rest, and the radius of the room it wanders in. */
export const STOOL = { x: -2.1, z: -1.3, heading: Math.PI * 0.75 }
export const ARENA = 3.3
export const newWorld = (): WorldState => ({ x: 0, z: 0, heading: 0, phase: 0, sit: 0, stretch: 0, look: 0, goal: null, forIntent: null, lookDir: 1 })

const MOVERS: ReadonlySet<Intent> = new Set<Intent>(['stroll', 'walk', 'pace', 'jog', 'run'])
const wrap = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a }

/** Advance the avatar by dt seconds for its current intent. Mutates and returns the state. rng supplies goal choices. */
export function stepWorld(w: WorldState, dt: number, intent: Intent, gait: Gait, rng: () => number): WorldState {
  if (w.forIntent !== intent) { w.goal = null; w.stretch = 0; w.forIntent = intent }
  const resting = intent === 'rest'
  let moveSpeed = 0, cycle = 0

  if (MOVERS.has(intent) || resting) {
    if (resting) w.goal = { x: STOOL.x, z: STOOL.z }
    else if (!w.goal || Math.hypot(w.goal.x - w.x, w.goal.z - w.z) < 0.25) {
      // pick somewhere new inside the room, at least a couple of metres away
      for (let i = 0; i < 12; i++) {
        const r = Math.sqrt(rng()) * (ARENA - 0.4), a = rng() * Math.PI * 2, gx = r * Math.cos(a), gz = r * Math.sin(a)
        if (Math.hypot(gx - w.x, gz - w.z) > 1.8 && Math.hypot(gx - STOOL.x, gz - STOOL.z) > 0.8) { w.goal = { x: gx, z: gz }; break }
      }
    }
    if (w.goal) {
      const dx = w.goal.x - w.x, dz = w.goal.z - w.z, dist = Math.hypot(dx, dz)
      const arrived = dist < (resting ? 0.12 : 0.2)
      if (resting && arrived) {
        const turn = wrap(STOOL.heading - w.heading); w.heading += Math.sign(turn) * Math.min(Math.abs(turn), 3 * dt)
        w.sit = Math.min(1, w.sit + dt * 0.7)
      } else if (!arrived) {
        const want = Math.atan2(dx, dz), err = wrap(want - w.heading)
        w.heading += Math.sign(err) * Math.min(Math.abs(err), (2.6 / (0.6 + gait.speed * 0.25)) * dt)
        const sp = (resting ? 0.9 : gait.speed) * Math.max(0, Math.cos(err)) ** 2
        moveSpeed = Math.min(sp, dist / Math.max(dt, 1e-3)); cycle = gait.moving || resting ? (resting ? 0.65 : gait.cycle) : 0
        w.x += Math.sin(w.heading) * moveSpeed * dt; w.z += Math.cos(w.heading) * moveSpeed * dt
        w.sit = Math.max(0, w.sit - dt * 1.6)
      }
    }
  } else {
    w.sit = Math.max(0, w.sit - dt * 0.9)
    if (intent === 'stretch') w.stretch = Math.min(1, w.stretch + dt / 4.5)
    if (intent === 'look') { w.look += w.lookDir * dt * 0.45; if (Math.abs(w.look) >= 1) { w.look = Math.sign(w.look); w.lookDir = (w.lookDir * -1) as 1 | -1 } }
  }
  if (intent !== 'look') w.look *= Math.exp(-dt * 2.5)
  if (intent !== 'stretch') w.stretch = Math.max(0, w.stretch - dt / 2)

  // keep inside the room
  const rr = Math.hypot(w.x, w.z)
  if (rr > ARENA) { w.x *= ARENA / rr; w.z *= ARENA / rr; w.goal = null }
  w.phase += 2 * Math.PI * cycle * dt * (moveSpeed > 0 ? Math.min(1, moveSpeed / Math.max(0.2, gait.speed)) : 0)
  return w
}
