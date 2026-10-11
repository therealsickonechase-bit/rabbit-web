// Turns a chemical pathway plus a damage scenario into the curves the 3D view draws. Pure geometry, tested without a browser.

import * as THREE from 'three'
import { MIDLINE, NUC, SCENARIOS, SYSTEM_ROUTES, firstCut, type RouteDef, type ScenarioId, type SystemId } from './neuro.ts'

export interface Route {
  def: RouteDef
  side: -1 | 1
  /** the part of the route that still carries signal (the whole route when nothing cuts it) */
  live: THREE.Vector3[]
  /** the part beyond a lesion, drawn as grey dashes (empty when not cut) */
  rest: THREE.Vector3[]
  cut: boolean
  /** 1 = normal, lower = weakened across the whole brain by the scenario */
  strength: number
  /** how many pulses to animate along it */
  pulses: number
  bidirectional: boolean
}

export const nucleusPoint = (key: string, side: -1 | 1) => new THREE.Vector3(NUC[key][0] * side, NUC[key][1], NUC[key][2])

export function buildRoutes(system: SystemId, scenario: ScenarioId): Route[] {
  const sc = SCENARIOS[scenario], spec = SYSTEM_ROUTES[system], strength = sc.impair[system] ?? 1
  const out: Route[] = []
  for (const def of spec.routes) {
    for (const side of [-1, 1] as const) {
      if (MIDLINE.has(def.a) && MIDLINE.has(def.b) && side === 1) continue      // midline-to-midline routes are drawn once
      const A = nucleusPoint(def.a, side), B = nucleusPoint(def.b, side), mid = A.clone().add(B).multiplyScalar(0.5)
      mid.z += 0.08 + 0.1 * A.distanceTo(B)
      const pts = new THREE.CatmullRomCurve3([A, mid, B]).getPoints(48)
      const cutAt = firstCut(pts.map((p) => [p.x, p.y, p.z] as [number, number, number]), sc.lesions)
      out.push({
        def, side, live: cutAt < 0 ? pts : pts.slice(0, cutAt + 1), rest: cutAt < 0 ? [] : pts.slice(cutAt), cut: cutAt >= 0, strength,
        pulses: Math.max(1, Math.round((def.soft ? 1 : 3) * strength)), bidirectional: !!spec.bidirectional,
      })
    }
  }
  return out
}
