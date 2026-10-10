// Loads a Mixamo-rigged human model (Michelle, from the three.js examples) at run time and drives it with the same joint angles as the built-in body.
// RabbitOS does NOT host or bundle the file: it is fetched in the visitor's browser from a pinned commit of the three.js repository on GitHub.
// The model is a Mixamo character; Mixamo's own terms apply to it (see the credit below). If the download fails, the built-in body is used instead.
//
// Retargeting: the model rests in a T-pose with its own bone axes. Every angle in `boneEulers` is defined for an upright figure with the arms hanging down,
// in axes aligned with the room (X sideways, Y up, Z forward). For a bone b with parent p, canonical rest orientation W'(b) (the rest orientation with the arms
// swung down) and pose rotation q(b), the local rotation is  L(b) = W'(p)^-1 * q(b) * W'(b).  Deltas then compose down the chain exactly as in the built-in skeleton.

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { boneEulers, type BoneName, type Figure } from './avatar-body.ts'
import type { Pose } from './avatar-motion.ts'

export const MICHELLE_URL = 'https://raw.githubusercontent.com/mrdoob/three.js/11738a9d55e502fb484cefffcea3a66dc44e9fe9/examples/models/gltf/Michelle.glb'
export const MICHELLE_CREDIT = 'Michelle is a Mixamo character that ships as a three.js example model. RabbitOS does not host it: your browser fetches it from GitHub. Mixamo’s terms apply to it, so check them before using it beyond a demo.'
export const MICHELLE_HEIGHT = 1.68

const TARGETS: [BoneName, string][] = [
  ['pelvis', 'Hips'], ['spine', 'Spine'], ['chest', 'Spine1'], ['neck', 'Neck'], ['head', 'Head'],
  ['armL', 'LeftArm'], ['foreL', 'LeftForeArm'], ['thighL', 'LeftUpLeg'], ['shinL', 'LeftLeg'], ['footL', 'LeftFoot'],
  ['armR', 'RightArm'], ['foreR', 'RightForeArm'], ['thighR', 'RightUpLeg'], ['shinR', 'RightLeg'], ['footR', 'RightFoot'],
]

/** Three.js removes ':' from node names, so "mixamorig:Hips" becomes "mixamorigHips". Accept either. */
const findBone = (root: THREE.Object3D, short: string) => root.getObjectByName(`mixamorig${short}`) ?? root.getObjectByName(`mixamorig:${short}`) ?? null

export async function loadMichelle(url = MICHELLE_URL, signal?: AbortSignal): Promise<Figure> {
  const gltf = await new GLTFLoader().loadAsync(url)
  if (signal?.aborted) throw new Error('cancelled')
  const model = gltf.scene
  const root = new THREE.Group(); root.add(model)
  root.updateMatrixWorld(true)

  const bones = new Map<string, THREE.Object3D>()
  for (const [, short] of TARGETS) { const b = findBone(model, short); if (!b) throw new Error(`the model has no ${short} bone`); bones.set(short, b) }
  const toe = findBone(model, 'LeftToeBase'), foot = findBone(model, 'LeftFoot'), head = findBone(model, 'Head'), hips = findBone(model, 'Hips'), lArm = findBone(model, 'LeftArm'), lFore = findBone(model, 'LeftForeArm')
  if (!toe || !foot || !head || !hips || !lArm || !lFore) throw new Error('the model does not look like a Mixamo rig')

  // face +Z and put the avatar's left on +X
  const pos = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3())
  if (pos(toe).z < pos(foot).z) { model.rotation.y = Math.PI; root.updateMatrixWorld(true) }
  const leftOnPlusX = pos(lArm).x > pos(hips).x
  const paired = /^(arm|fore|thigh|shin|foot)[LR]$/
  const side = (b: BoneName): BoneName => {
    if (!paired.test(b) || leftOnPlusX) return b
    return (b.slice(0, -1) + (b.endsWith('L') ? 'R' : 'L')) as BoneName          // the model's left is on -X: use the angles of the opposite side
  }

  // size and floor
  const box = new THREE.Box3().setFromObject(model)
  const scale = MICHELLE_HEIGHT / (box.max.y - box.min.y)
  model.scale.setScalar(scale); model.position.y = -box.min.y * scale
  root.updateMatrixWorld(true)

  // canonical rest orientations: arms swung from the T-pose down to hanging
  const worldQ = (o: THREE.Object3D) => o.getWorldQuaternion(new THREE.Quaternion())
  const armDir = (a: THREE.Object3D, f: THREE.Object3D) => pos(f).sub(pos(a)).normalize()
  const hang = new THREE.Vector3(0, -1, 0)
  const H = { L: new THREE.Quaternion().setFromUnitVectors(armDir(lArm, lFore), hang), R: new THREE.Quaternion() }
  const rArm = findBone(model, 'RightArm'), rFore = findBone(model, 'RightForeArm')
  if (rArm && rFore) H.R.setFromUnitVectors(armDir(rArm, rFore), hang)
  const sideOf = (o: THREE.Object3D): 'L' | 'R' | null => { let n: THREE.Object3D | null = o; while (n) { if (/(Left|Right)(Arm|ForeArm|Hand)/.test(n.name)) return /Left/.test(n.name) ? 'L' : 'R'; n = n.parent } return null }
  const canon = new Map<THREE.Object3D, THREE.Quaternion>()
  model.traverse((o) => {
    const w = worldQ(o), s = sideOf(o)
    canon.set(o, s ? new THREE.Quaternion().copy(H[s]).multiply(w) : w)
  })
  const restHips = hips.position.clone()
  const q = new THREE.Quaternion(), e = new THREE.Euler()
  const driven = TARGETS.map(([mine, short]) => ({ mine, bone: bones.get(short)!, parentCanon: canon.get(bones.get(short)!.parent!)!, selfCanon: canon.get(bones.get(short)!)! }))
  const spine2 = findBone(model, 'Spine2')
  const spine2Info = spine2 ? { bone: spine2, parentCanon: canon.get(spine2.parent!)!, selfCanon: canon.get(spine2)! } : null

  const meshes: THREE.Mesh[] = []
  const materials = new Set<THREE.Material>()
  model.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; meshes.push(m); for (const mat of Array.isArray(m.material) ? m.material : [m.material]) materials.add(mat) }
  })

  const apply = (p: Pose) => {
    const eul = boneEulers(p)
    for (const { mine, bone, parentCanon, selfCanon } of driven) {
      const a = eul[side(mine)] ?? [0, 0, 0]
      e.set(a[0], a[1], a[2], 'YXZ'); q.setFromEuler(e)
      bone.quaternion.copy(parentCanon).invert().multiply(q).multiply(selfCanon)
    }
    // the model has three spine bones; the avatar has two: the chest rotation is shared between the upper two
    const c = eul[side('chest')] ?? [0, 0, 0]
    if (spine2Info) {
      e.set(c[0] * 0.5, c[1] * 0.5, 0, 'YXZ'); q.setFromEuler(e)
      spine2Info.bone.quaternion.copy(spine2Info.parentCanon).invert().multiply(q).multiply(spine2Info.selfCanon)
      const s1 = driven.find((d) => d.mine === 'chest')!
      e.set(c[0] * 0.5, c[1] * 0.5, 0, 'YXZ'); q.setFromEuler(e)
      s1.bone.quaternion.copy(s1.parentCanon).invert().multiply(q).multiply(s1.selfCanon)
    }
    hips.position.set(restHips.x, restHips.y + p.rootY / scale, restHips.z)
  }

  return {
    root, xray: [...materials], apply,
    tint() { /* the model's skin is a photographic texture; it is not recoloured */ },
    dispose() {
      for (const m of meshes) m.geometry.dispose()
      for (const mat of materials) { const mm = mat as THREE.MeshStandardMaterial; mm.map?.dispose(); mm.normalMap?.dispose(); mm.roughnessMap?.dispose(); mm.dispose() }
    },
  }
}
