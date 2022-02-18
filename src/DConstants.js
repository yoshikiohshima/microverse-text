// Copyright 2022 by Croquet Corporation. All Rights Reserved.
// Shared Dynaverse Constants
// Layers - there can be up to 32 different layers
// Events - pointer events are generated by the mouse, touch or XR control devices.

export const D_CONSTANTS ={LIGHT_LAYER:1, EVENT_LAYER:2, WALK_LAYER:3, 
    COLLIDE_LAYER:4, AVATAR_LAYER:5, PORTAL_LAYER: 6,
    LIGHT:1, EVENT:2, WALK:3, COLLIDE:4, AVATAR:5, 
    POINTER_DOWN: 1001, POINTER_UP: 1002, 
    POINTER_MOVE:1003, POINTER_CANCEL:1004,
    EYE_HEIGHT:1.7, // height of eyes above ground in meters
    EYE_EPSILON: 0.01 // don't replicate the change unless it is sufficiently large
    };

export const D = D_CONSTANTS;