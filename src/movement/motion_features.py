"""Teacher-first representation experiments; no fixture knowledge or action labels."""
import numpy as np

MP = [11,12,13,14,15,16,23,24,25,26,27,28]
EDGES = [(6,0),(7,1),(0,2),(2,4),(1,3),(3,5),(6,8),(8,10),(7,9),(9,11),(0,1),(6,7)]
PARENTS = [10,10,0,2,1,4,11,6,11,8,11,10]


def features(frame, strategy="rtmw-3d"):
    body = frame.get("bodySkeleton")
    if strategy == "rtmw-3d":
        if not body or not body["orientationReliable"] or sum(c >= .5 for c in body["boneConfidence"]) < 6:
            return None
        return np.array(body["bones"]), np.array(body["boneConfidence"])
    image = strategy in ("rtmw-xy", "rtmw-hybrid", "mediapipe-xy")
    if image:
        landmarks = frame.get("landmarks", [])
        if len(landmarks) < 29:
            return None
        size = body.get("imageSize", [640,360]) if body else frame.get("imageSize", [640,360])
        points = np.array([[landmarks[i]["x"]*size[0],landmarks[i]["y"]*size[1],0.] for i in MP])
        confidence = np.array([landmarks[i].get("visibility",0.) for i in MP])
    elif strategy.startswith("mediapipe"):
        landmarks = frame.get("worldLandmarks", [])
        if len(landmarks) < 29:
            return None
        points = np.array([[landmarks[i][k] for k in ("x","y","z")] for i in MP])
        confidence = np.array([landmarks[i].get("visibility",frame["landmarks"][i].get("visibility",0.)) for i in MP])
    else:
        if not body:
            return None
        points = np.array(body["joints"]) @ np.array(body["basis"])
        confidence = np.array(body["confidence"])
    bones = np.array([points[b]-points[a] for a,b in EDGES])
    lengths = np.linalg.norm(bones,axis=1)
    bones /= np.maximum(lengths[:,None],1e-9)
    weights = np.array([min(confidence[a],confidence[b]) for a,b in EDGES])
    weights[lengths < 1e-6] = 0
    if strategy in ('mediapipe-body','mediapipe-kinematic-body'):
        lateral=(points[1]-points[0])*min(confidence[0],confidence[1])+(points[7]-points[6])*min(confidence[6],confidence[7])
        lateral[1]=0
        if np.linalg.norm(lateral)<1e-6:
            return None
        lateral/=np.linalg.norm(lateral)
        vertical=np.array([0.,1.,0.])
        forward=np.cross(lateral,vertical)
        bones=bones@np.column_stack([lateral,vertical,forward])
    if strategy=='mediapipe-kinematic-body':
        values=np.column_stack([bones,np.sum(bones*bones[PARENTS],axis=1)])
        matrix_confidence=np.column_stack([np.repeat(weights[:,None],3,axis=1),np.minimum(weights,weights[PARENTS])])
    elif strategy=='mediapipe-gram':
        # Complete inter-bone geometry, gravity, and handedness; not just parent flexion.
        gram=bones@bones.T
        chirality=np.sum(np.cross(bones,bones[11])*np.array([0.,1.,0.]),axis=1)
        values=np.column_stack([bones[:,1],gram,chirality])
        matrix_confidence=np.minimum(weights[:,None],weights[None,:])
        matrix_confidence=np.column_stack([weights,matrix_confidence,np.minimum(weights,weights[11])])
    elif strategy.endswith("invariant"):
        # Gravity inclination and rotation-invariant inter-bone flexion. All 12 bones contribute.
        values = np.column_stack([bones[:,1],np.sum(bones*bones[PARENTS],axis=1),np.zeros(12)])
        weights = np.minimum(weights,weights[PARENTS])
    else:
        values = bones
    if strategy == "rtmw-hybrid" and body.get("depthConfidence"):
        depth = np.minimum(np.array(body["depthConfidence"]),confidence)
        if len(depth) == 12:
            values[:,2] = np.array(body["bones"])[:,2] * depth
    if not np.isfinite(values).all() or np.mean(weights) < .15 or np.sum(weights > .3) < 4:
        return None
    return values,matrix_confidence if strategy in ('mediapipe-gram','mediapipe-kinematic-body') else weights


def distances(a,b,strict=False):
    av,aw = a
    bv,bw = b
    w = np.minimum(aw[:,None,:],bw[None,:,:])
    if strict:
        w = (w >= .5).astype(float)
    else:
        w = w*w
    error = np.sum((av[:,None,:,:]-bv[None,:,:,:])**2,axis=3)
    denominator = np.sum(w,axis=2)
    result = np.sqrt(np.sum(w*error,axis=2)/np.maximum(denominator,1e-9))
    effective = denominator**2/np.maximum(np.sum(w*w,axis=2),1e-9)
    result[effective < (6 if strict else 4)] = np.inf
    return result


def pack(rows):
    return np.array([r[0] for r in rows]),np.array([r[1] for r in rows])
