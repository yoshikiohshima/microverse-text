import {THREE, PM_ThreeVisible, AM_Spatial, PM_Spatial, PM_Focusable, Actor, Pawn, mix} from "@croquet/worldcore";
import {getTextGeometry, HybridMSDFShader, MSDFFontPreprocessor, getTextLayout} from "hybrid-msdf-text";
import loadFont from "load-bmfont";
import { PM_Events } from '../DEvents.js';
import { PM_LayerTarget } from '../DLayerManager.js';
import { D } from '../DConstants.js';

import {Doc, Warota, canonicalizeKeyboardEvent, eof, fontRegistry} from "./warota.js";

export class TextFieldActor extends mix(Actor).with(AM_Spatial) {
    init(...args) {
        this.doc = new Doc();
        this.doc.load([]);
        // this.doc.load([
        // {text: "ab c ke eke ekeke ekek eke ek eke ke ek eke ek ek ee  ke kee ke", style: {size: 24}},
        // ]);

        this.content = {runs: [], selections: {}, undoStacks: {}, timezone: 0, queue: [], editable: true};
        this.fonts = new Map();

        super.init(...args);

        this.subscribe(this.id, "editEvents", "receiveEditEvents");
        this.subscribe(this.id, "accept", "publishAccept");
        this.subscribe(this.id, "undoRequest", "undoRequest");
        this.subscribe(this.id, "setExtent", "setExtent");
        this.subscribe(this.sessionId, "view-exit", "viewExit");

        this.listen("askFont", "askFont");

        // the height part of this is optional, in the sense that the view may do something else
        this.setExtent({width: 500, height: 500});
    }

    get pawn() {return TextFieldPawn;}

    static types() {
        return {"Warota.Doc": Doc};
    }

    load(stringOrArray) {
        let runs;
        if (typeof stringOrArray === "string") {
            runs = [{text: stringOrArray}];
        } else {
            runs = stringOrArray;
        }
        this.doc.load(runs);
        this.publishChanged();
        this.needsUpdate();
    }

    save() {
        return {runs: this.doc.runs, defaultFont: this.doc.defaultFont, defaultSize: this.doc.defaultSize};
    }

    setExtent(ext) {
        this.extent = ext;
    }

    loadAndReset(stringOrArray) {
        let runs;
        if (typeof stringOrArray === "string") {
            runs = [{text: stringOrArray}];
        } else {
            runs = stringOrArray;
        }
        this.content = {runs: runs, selections: {}, undoStacks: {}, timezone: 0, queue: [], editable: true};
        this.doc.load(runs);
        this.publishChanged();
        this.needsUpdate();
    }

    receiveEditEvents(events) {
        let [timezone, hasDone] = this.doc.receiveEditEvents(events, this.content, this.doc);
        if (hasDone) {
            this.publishChanged();
        }

        this.needsUpdate();
    }

    publishAccept() {
        console.log("accept");
        this.publish(this.id, "text", {id: this.id, text: this.doc.plainText()});
    }

    publishChanged() {
        this.publish(this.id, "changed", {id: this.id});
    }

    viewExit(viewId) {
        // we might have to clear the events of Warota in the view?
        delete this.content.selections[viewId];
        this.needsUpdate();
    }

    needsUpdate() {
        this.say("screenUpdate", this.content.timezone);
    }

    undoRequest(user) {
        let event;
        let queue = this.content.queue;
        for (let i = queue.length - 1; i >= 0; i--) {
            let e = queue[i];
            if (e.user.id === user.id && (e.type !== "snapshot" && e.type !== "select")) {
                event = queue[i];
                break;
            }
        }
        if (!event) {return;}

        this.doc.undoEvent(event, this.content, this.doc);
        this.needsUpdate();
    }

    setDefault(font, size) {
        return this.doc.setDefault(font, size);
    }

    askFont(data) {
        console.log(data);
        if (data.font) {
            this.fonts.set(data.name, data.font);
        }
        this.say("fontAsked", data.name);
    }

    styleAt(index) {
        return this.doc.styleAt(index);
    }

    get value() {
        return this.doc.plainText();
    }

    set value(text) {
        return this.load(text);
    }
}

TextFieldActor.register("TextFieldActor");

export class TextFieldPawn extends mix(Pawn).with(PM_Spatial, PM_ThreeVisible, PM_LayerTarget) {
    constructor(model) {
        super(model);
        this.model = model;

        this.widgets = {};
        this.hiddenInput = document.createElement("input");
        this.hiddenInput.style.setProperty("position", "absolute");

        this.hiddenInput.style.setProperty("left", "-120px"); //-120px
        this.hiddenInput.style.setProperty("top", "-120px");  // -120px
        // this.hiddenInput.style.setProperty("transform", "scale(0)"); // to make sure the user never sees a flashing caret, for example on iPad/Safari

        this.hiddenInput.style.setProperty("width", "100px");
        this.hiddenInput.style.setProperty("height", "100px");

        this.hiddenInput.addEventListener("input", evt => this.input(evt), true);
        this.hiddenInput.addEventListener("keydown", evt => this.keyDown(evt), true);
        this.hiddenInput.addEventListener("copy", evt => this.copy(evt));
        this.hiddenInput.addEventListener("cut", evt => this.cut(evt));
        this.hiddenInput.addEventListener("paste", evt => this.paste(evt));
        document.body.appendChild(this.hiddenInput);

        this.setupEditor();
        this.setupMesh();

        this.fonts = new Map();
        this.isLoading = {};

        this.listen("fontAsked", "askFont");
        this.listen("screenUpdate", "screenUpdate");

        this.setupDefaultFont().then(() => {
            let fonts = Array.from(this.model.fonts.keys());
            let ps = fonts.map((v) => this.askFont(v));
            return Promise.all(ps);
        }).then(() => {
            this.needsUpdate();
        });

        this.viewExtent = this.model.extent;
        window.view = this;
    }

    _pointerDown(p3d) {
        return this.pointerDown(p3d);
    }

    _pointerUp(p3d) {
        return this.pointerUp(p3d);
    }

    _pointerMove(p3d) {
        return this.pointerMove(p3d);
    }

    /*

    _pointerCancel(p3d){
        console.log("pointerCancel", p3d);
    }
    _pointerEnter(p3d){
        console.log("pointerEnter", p3d);
    }
    _pointerOver(p3d){
        console.log("pointerOver", p3d);
    }
    _pointerLeave(p3d){
        console.log("pointerLeave", p3d);
    }
    _pointerWheel(p3d){
        console.log("pointerWheel", p3d);
    }
    */

    destroy() {
        super.destroy();

        ["geometry", "material", "textGeometry"].forEach((n) => {
            if (this[n]) {
                this[n].dispose();
                this[n] = null;
            }
        });

        this.fonts.forEach((v, _k) => {
            if (v.material) {
                v.material.dispose();
                v.material = null;
            }
        });

        if (this.hiddenInput) {
            this.hiddenInput.remove();
        }
    }

    test() {
        // this.warota.insert(user, [{text: cEvt.key}]);
    }

    needsUpdate() {
        this.screenUpdate(this.warota.timezone);
    }

    randomColor(viewId) {
        let h = Math.floor(parseInt(viewId, 36) / (10 ** 36 / 360));
        let s = "40%";
        let l = "40%";
        return `hsl(${h}, ${s}, ${l})`;
    }

    changeMaterial(name, makeNew) {
        let textMesh;
        if (!this.fonts.get(name)) {return;}
        if (!this.fonts.get(name).material) {
            let texture = this.fonts.get(name).texture;
            this.fonts.get(name).material = new THREE.RawShaderMaterial(HybridMSDFShader({
                map: texture,
                textureSize: texture.image.width,
                side: THREE.DoubleSide,
                transparent: true
            }, THREE));
        }

        if (makeNew) {
            textMesh = new THREE.Mesh(this.textGeometry, this.fonts.get(name).material);
            textMesh.name = "text";
        } else {
            let m = this.textMesh.material;
            this.textMesh.material = this.fonts.get(name).material;
            if (m) {
                m.dispose();
            }
        }
        return textMesh;
    }

    setupTextMesh(name, font) {
        if (!this.textGeometry) {
            let TextGeometry = getTextGeometry(THREE);
            this.textGeometry = new TextGeometry({});

            this.textMesh = this.changeMaterial(name, true);
            this.plane.add(this.textMesh);
        }

        let layout = fontRegistry.hasLayout(name);
        if (!layout) {
            let TextLayout = getTextLayout(THREE);
            layout = new TextLayout({font});
            fontRegistry.addLayout(name, layout);
        }
    }

    setupScrollMesh() {
        let geom = new THREE.PlaneGeometry(0.1, 5);
        let mat = new THREE.MeshBasicMaterial({color: 0xFF0000, side: THREE.DoubleSide});
        this.scrollMesh = new THREE.Mesh(geom, mat);
        this.scrollMesh.name = "scroll";
        this.scrollMesh.position.set(2.5, 0, 0.001);

        let knobGeom = new THREE.PlaneGeometry(0.1, 0.1);
        let knobMat = new THREE.MeshBasicMaterial({color: 0x00FF00, side: THREE.DoubleSide});
        this.scrollKnobMesh = new THREE.Mesh(knobGeom, knobMat);
        this.scrollKnobMesh.name = "scrollKnob";

        this.scrollKnobMesh.position.set(0, 2.5, 0.001);
        this.scrollMesh.add(this.scrollKnobMesh);
        this.plane.add(this.scrollMesh);
    }

    updateMesh(stringInfo) {
        let {fontName, extent, drawnStrings} = stringInfo;
        if (!this.fonts.get(fontName)) {return;}
        let font = this.fonts.get(fontName).font;

        drawnStrings = drawnStrings.map(spec => ({...spec, font: font}));

        let layout = fontRegistry.hasLayout(fontName);
        if (!layout) {return;}

        let glyphs = layout.computeGlyphs({font, drawnStrings});

        this.textMesh.scale.x = 0.01;
        this.textMesh.scale.y = -0.01;

        let newWidth = extent.width * 0.01;
        let newHeight = extent.height * 0.01;

        if (newWidth !== this.plane.geometry.parameters.width ||
            newHeight !== this.plane.geometry.parameters.height) {
            let geometry = new THREE.PlaneGeometry(newWidth, newHeight);
            this.plane.geometry = geometry;
            this.geometry.dispose();
            this.geometry = geometry;

            this.textMesh.position.x = -newWidth / 2;
            this.textMesh.position.y = newHeight / 2;
            this.textMesh.position.z = 0.005;
        }
        this.textGeometry.update({font, glyphs});
        let bounds = {left: 0, top: 0, bottom: extent.height, right: extent.width};
        this.fonts.get(fontName).material.uniforms.corners.value = new THREE.Vector4(bounds.left, bounds.top, bounds.right, bounds.bottom);
    }

    setupMesh() {
        this.geometry = new THREE.PlaneGeometry(0, 0);
        this.material = new THREE.MeshBasicMaterial({color: 0xFFFFFF, side: THREE.DoubleSide});
        this.plane = new THREE.Mesh(this.geometry, this.material);
        this.plane.name = "plane";
        this.layer = D.EVENT;
        this.setRenderObject(this.plane);

        // this.setupScrollMesh();

        this.clippingPlanes = [
            new THREE.Plane(new THREE.Vector3(0, 1, 0),  0),
            new THREE.Plane(new THREE.Vector3(0, -1, 0), 0),
            new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0),
            new THREE.Plane(new THREE.Vector3(1, 0, 0), 0)
        ];
        
    }

    setupEditor() {
        let font = this.model.doc.defaultFont;
        let fontSize = this.model.doc.defaultSize;
        let options = {width: 500, height: 500, font, fontSize};
        this.singleLine = false;
        if (this.singleLine) {
            options.singleLine = true;
        }

        this.warota = new Warota(options, this.model.doc);
        this.warota.width(500);
        this.options = options;

        this.user = {id: this.viewId, color: this.randomColor(this.viewId)};
        this.selections = {}; // {user: {bar: mesh, boxes: [mesh]}}

        this.subscribe(this.viewId, "synced", "synced");
        this.screenUpdate(this.warota.timezone);
    }

    setupDefaultFont() {
        let fontName = "DejaVu Sans Mono";
        return this.askFont(fontName, true).then((font) => {
            return this.setupTextMesh(fontName, font.font);
        });
    }

    askFont(name, me) {
        if (this.fonts.get(name)) {return Promise.resolve(null);}
        if (this.isLoading[name]) {return Promise.resolve(null);}
        this.isLoading[name] = true;
        console.log("start loading");

        let path = "./assets/fonts";
        let image = `${path}/${name}.png`;

        return new Promise((resolve, reject) => {
            loadFont(`${path}/${name}.json`, (err, font) => {
                if (err) throw err;
                let loader = new THREE.TextureLoader();
                loader.load(
                    image,
                    (tex) => {
                        console.log('begin registering');
                        let preprocessor = new MSDFFontPreprocessor();
                        let img = new Image(font.common.scaleW, font.common.scaleH);
                        let canvas = document.createElement("canvas");
                        canvas.width = font.common.scaleW;
                        canvas.height = font.common.scaleH;
                        let ctx = canvas.getContext("2d");
                        ctx.drawImage(tex.image, 0, 0);
                        let inBitmap = ctx.getImageData(0, 0, canvas.width, canvas.height);
                        let outImage = preprocessor.process(font, inBitmap.data);
                        ctx.putImageData(outImage, 0, 0);

                        let processedTexture = new THREE.Texture(outImage);
                        processedTexture.minFilter = THREE.LinearMipMapLinearFilter;
                        processedTexture.magFilter = THREE.LinearFilter;
                        processedTexture.generateMipmaps = true;
                        processedTexture.anisotropy = 1; // maxAni

                        img.src = canvas.toDataURL("image/png");
                        img.onload = () => {
                            console.log('in onload for img');
                            processedTexture.needsUpdate = true;
                        };

                        this.fonts.set(name, {font, texture: processedTexture});
                        delete this.isLoading[name];
                        if (me) {
                            let maybeFont = this.model.fonts.get(name) ? null : font;
                            this.say("askFont", {name, font: maybeFont});
                        }
                        resolve(this.fonts.get(name));
                    },
                    null,
                    () => {
                        this.isLoading[name] = false;
                        reject(new Error(`failed to load font: ${name}`));
                    });
            });
        });
    }

    computeClippingPlanes(ary) {
        //let [top, bottom, right, left] = ary; this is the order
        let planes = [];
        let text = this.plane;
        if (Number.isNaN(text.matrixWorld.elements[0])) return [];
        for (let i = 0; i < 4; i++) {
            planes[i] = new THREE.Plane();
            planes[i].copy(this.clippingPlanes[i]);
            planes[i].constant = ary[i];
            planes[i].applyMatrix4(text.matrixWorld);
        }
        return planes;
    }

    setWidth(pixels) {
        this.publish(this.model.id, "setWidth", pixels);
        this.width(pixels);
    }

    width(pixels) {
        this.warota.width(pixels);
        this.screenUpdate(this.warota.timezone);
    }

    synced(value) {
        this.isSynced = value;
        if (!this.isSynced) {return;}
        this.warota.resetMeasurer();
        this.screenUpdate(this.warota.timezone);
    }

    accept() {
        this.publish(this.model.id, "accept");
    }

    apply(time, elem, world) {
        super.apply(time, elem, world);
        let w = elem.style.getPropertyValue("width");
        this.width(parseInt(w, 10));

        if (this._lastValues.get("enterToAccept") !== this.model["enterToAccept"]) {
            let accept = this.model["enterToAccept"];
            this._lastValues.set("enterToAccept", accept);
            if (accept) {
                this.dom.style.setProperty("overflow", "hidden");
                this.text.style.setProperty("overflow", "hidden");
            } else {
                this.dom.style.removeProperty("overflow");
                this.text.style.removeProperty("overflow");
            }
        }
        this.screenUpdate(this.warota.timezone);
    }

    cookEvent(evt) {
        console.log(evt);
    }

    pointerDown(evt) {
        let [x, y] = evt.localPoint;
        this.warota.mouseDown(x, y, y, this.user);
        if (this.hiddenInput) {
            this.hiddenInput.focus();
        }
    }

    pointerMove(evt) {
        let [x, y] = evt.localPoint;
        this.warota.mouseMove(Math.max(x, 0), y, y, this.user);
        this.changed();
    }

    pointerUp(evt) {
        console.log(evt.localPoint);
        let [x, y] = evt.localPoint;
        this.warota.mouseUp(x, y, y, this.user);
        this.changed();
    }

    newCanonicalizeEvent(evt) {
        if (evt.type === "input" && evt.inputType === "insertText" && !evt.isComposing) {
            let key = this.hiddenInput.value;
            this.hiddenInput.value = "";
            let spec = {
                keyCombo: "",
                key: key,
                shiftKey: false,
                altKey: false,
                ctrlKey: false,
                metaKey: false,
                altGraphKey: false,
                isFunctionKey: false,
                isModified: false,
                onlyModifiers: false,
                onlyShiftModifier: null,
                type: evt.type,
                keyCode: evt.keyCode
            };
            return spec;
        }
        return null;
    }

    eventFromField() {
        let key = this.hiddenInput.value;
        this.hiddenInput.value = "";
        let spec = {
            keyCombo: "",
            key: key,
            shiftKey: false,
            altKey: false,
            ctrlKey: false,
            metaKey: false,
            altGraphKey: false,
            isFunctionKey: false,
            isModified: false,
            onlyModifiers: false,
            onlyShiftModifier: null,
            type: "",
            keyCode: 0
        };
        return spec;
    }

    simpleInput(text, evt) {
        let user = this.user;
        let selection = this.model.content.selections[this.viewId];
        let style = this.model.styleAt(Math.max(selection ? selection.start - 1 : 0, 0));

        this.warota.insert(user, [{text, style}]);
        this.changed(true);
        evt.preventDefault();
        return true;
    }

    input(evt) {
        let cEvt = this.newCanonicalizeEvent(evt);
        if (!cEvt) {return false;}
        let user = this.user;
        let selection = this.model.content.selections[this.viewId];
        let style = this.model.styleAt(Math.max(selection ? selection.start - 1 : 0, 0));
        this.warota.insert(user, [{text: cEvt.key, style: style}]);
        this.changed(true);
        evt.preventDefault();
        return true;
    }

    keyDown(evt) {
        let cEvt;
        if (evt.key === "Enter") {
            if (this.hiddenInput.value !== "") {
                this.hiddenInput.value = "";
                cEvt = this.eventFromField();
            } else {
                cEvt = canonicalizeKeyboardEvent(evt);
            }
        } else {
            cEvt = canonicalizeKeyboardEvent(evt);
        }

        let user = this.user;
        if (!cEvt) {return true;}

        if (cEvt.onlyModifiers) {return true;}

        // what has to happen here is that the kinds of keycombo that browser need to pass
        // through, and the kinds that the editor handles are different.
        // We need to separated them, and for the latter, the text commands list has
        // to be tested here.
        if (cEvt.keyCombo === "Meta-S" || cEvt.keyCombo === "Ctrl-S") {
            this.accept();
            evt.preventDefault();
            return true;
        }

        if (cEvt.keyCombo === "Meta-Z" || cEvt.keyCombo === "Ctrl-Z") {
            this.undo();
            evt.preventDefault();
            return true;
        }

        if (cEvt.keyCode === 13) {
            if (this.model["enterToAccept"]) {
                evt.preventDefault();
                this.accept();
                return true;
            }
            return this.simpleInput("\n", evt);
        }
        if (cEvt.keyCode === 32) {
            return this.simpleInput(" ", evt);
        }
        if (cEvt.keyCode === 9) {
            return this.simpleInput("\t", evt);
        }

        const handled = this.warota.handleKey(user, cEvt.keyCode, cEvt.shiftKey, cEvt.ctrlKey || cEvt.metaKey);

        if (!handled && !(cEvt.ctrlKey || cEvt.metaKey)) {
            this.warota.insert(user, [{text: cEvt.key}]);
            this.changed(true);
            evt.preventDefault();
            return true;
        }
        if (handled) {
            evt.preventDefault();
            this.changed(true);
        }
        return false;
    }

    copy(evt) {
        let text = this.warota.selectionText(this.user);
        evt.clipboardData.setData("text/plain", text);
        evt.preventDefault();
        return true;
    }

    cut(evt) {
        this.copy(evt);
        this.warota.insert(this.user, [{text: ""}]);//or something else to keep undo sane?
        this.changed(true);
        return true;
    }

    paste(evt) {
        let pasteChars = evt.clipboardData.getData("text");
        this.warota.insert(this.user, [{text: pasteChars}]);
        evt.preventDefault();
        this.changed(true);
        return true;
    }

    undo() {
        this.publish(this.model.id, "undoRequest", this.user);
    }

    changed(toScroll) {
        let events = this.warota.events;
        this.warota.resetEvents();
        if (events.length > 0) {
            this.scrollNeeded = !this.singleLine && toScroll;
            this.publish(this.model.id, "editEvents", events);
        }
    }

    screenUpdate(timezone) {
        this.warota.timezone = timezone;
        if (!this.isSynced) {return;}
        this.warota.layout();
        this.showText();
        this.setExtent();
        this.showSelections();
        if (this.scrollNeeded) {
            this.scrollNeeded = false;
            this.scrollSelectionToView();
        }
    }

    showText() {
        let drawnStrings = [];
        for (let i = 0; i < this.warota.words.length - 1; i++) {
            let word = this.warota.words[i];
            let str = {
                x: word.left,
                y: word.top,
                string: word.text,
                style: word.style && word.style.color
            };
            drawnStrings.push(str);
        }

        let extent = this.model.extent;

        this.updateMesh({fontName: "DejaVu Sans Mono", extent, drawnStrings});
    }

    setStyle(style) {
        this.warota.setStyle(this.user, style, false);
        this.changed();
    }

    mergeStyle(style) {
        this.warota.setStyle(this.user, style, true);
        this.changed();
    }

    setExtent() {
        let extent = this.viewExtent;
        if (!this.textMesh) {return;}

        let newWidth = extent.width * 0.01;
        let newHeight = this.warota.docHeight * 0.01;

        if (newWidth !== this.plane.geometry.parameters.width ||
            newHeight !== this.plane.geometry.parameters.height) {
            let geometry = new THREE.PlaneGeometry(newWidth, newHeight);
            this.plane.geometry = geometry;
            this.geometry.dispose();
            this.geometry = geometry;

            this.textMesh.position.x = -newWidth / 2;
            this.textMesh.position.y = newHeight / 2;
            this.textMesh.position.z = 0.005;
        }
        
        
        /*
        this.text.style.setProperty("height", this.warota.docHeight + "px");
        this.holder.style.setProperty("height", this.warota.docHeight + "px");
        */
    }

    ensureSelection(id) {
        let sel = this.selections[id];
        let modelSel = this.model.content.selections[id];
        let color = modelSel.color;
        if (!color) {
            color = "blue";
        }
        if (!sel) {
            const bar = new THREE.Mesh(new THREE.PlaneBufferGeometry(0.1, 0.1), new THREE.MeshBasicMaterial({color}));

            bar.onBeforeRender = this.selectionBeforeRender.bind(this);

            bar.visible = false;
            this.plane.add(bar);
            bar.name = "caret";
            // plane.onBeforeRender = this.selectionBeforeRender.bind(this);

            let boxes = [];
            for (let i = 0; i < 3; i++) {
                let box = new THREE.Mesh(new THREE.PlaneBufferGeometry(0, 0), new THREE.MeshBasicMaterial({color}));
                box.onBeforeRender = this.selectionBeforeRender.bind(this);
                box.visible = false;
                box.name = `box${i}`;
                this.plane.add(box);
                boxes.push(box);
            }
            sel = {bar, boxes};
        }
        this.selections[id] = sel;
        return sel;
    }

    showSelections() {
        let unused = {};
        for (let k in this.selections) {
            unused[k] = this.selections[k];
        }

        for (let k in this.model.content.selections) {
            delete unused[k];
            let thisSelection = this.ensureSelection(k);
            thisSelection.boxes.forEach(box => box.visible = false);
            let selection = this.model.content.selections[k];

            let width = this.plane.geometry.parameters.width;
            let height = this.plane.geometry.parameters.height;

            if (selection.end === selection.start) {
                let caret = thisSelection.bar;
                caret.visible = true;
                let caretRect = this.warota.barRect(selection);
                let geom = new THREE.PlaneBufferGeometry(caretRect.width * 0.01, caretRect.height * 0.01);
                let old = caret.geometry;
                caret.geometry = geom;
                if (old) {
                    old.dispose();
                }

                let left = (-width / 2) + (caretRect.left + 4) * 0.01; // ?
                let top = (height / 2) - (caretRect.top + caretRect.height / 2) * 0.01;
                caret.position.set(left, top, 0.003);
            } else {
                let rects = this.warota.selectionRects(selection);
                let boxes = thisSelection.boxes;
                console.log(rects);
                for (let i = 0; i < 3; i++) {
                    let box = boxes[i];
                    let rect = rects[i];
                    box.visible = false;
                    
                    if (rect) {
                        let left = (-width / 2) + ((rect.width / 2) + rect.left) * 0.01; // ?
                        let top = (height / 2) - (rect.top + rect.height / 2) * 0.01;
                        
                        let rWidth = rect.width * 0.01; // ?
                        let rHeight = rect.height * 0.01;

                        let geom = new THREE.PlaneBufferGeometry(rWidth, rHeight, 2, 2);
                        box.geometry = geom;
                        box.position.set(left, top, 0.001);
                        box.visible = true;
                    }
                }
            }
        }
        for (let k in unused) {
            this.selections[k].bar.remove();
            this.selections[k].boxes.forEach(box => box.remove());
            delete this.selections[k];
        }
        this.publish(this.id, "selectionUpdated");
    }

    scrollSelectionToView() {
        /*
        let scrollTop = this.dom.scrollTop;
        let viewHeight = parseFloat(this.dom.style.getPropertyValue("height"));
        let selection = this.model.content.selections[this.viewId];
        if (!selection) {return;}
        if (selection.end !== selection.start) {return;}
        let caretRect = this.warota.barRect(selection);

        if (caretRect.top + caretRect.height > viewHeight + scrollTop) {
            this.dom.scrollTop = caretRect.top + caretRect.height - viewHeight;
        } else if (caretRect.top < scrollTop) {
            this.dom.scrollTop = caretRect.top;
        }
        */
    }

    selectionBeforeRender(renderer, scene, camera, geometry, material, group) {
        /* 

        
        let meterInPixel = this.model.extent.width / 0.01;
        let scrollT = this.warota.scrollTop;
        let docHeight = this.warota.docHeight;
        let docInMeter = docHeight * meterInPixel;
        let top = -scrollT * docHeight;
        let bottom = -(top - 0.01);
        let right = 0.01 * (1.0 - this.warota.relativeScrollBarWidth);
        let left = 0;
        */

        let left = 2.5;
        let right = 2.5;
        let bottom = 2.5;
        let top = 2.5;
        let planes = this.computeClippingPlanes([top, bottom, right, left]);
        material.clippingPlanes = planes;
    }

    addWidget(name, dom) {
        if (this.widgets[name]) {
            this.removeWidget(name, dom);
        }
        this.widgets[name] = dom;
        this.selectionPane.appendChild(dom);
    }

    removeWidget(name, dom) {
        delete this.widgets[name];
        dom.remove();
    }
}
