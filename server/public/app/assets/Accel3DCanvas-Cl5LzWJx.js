import{r as st,j as bt}from"./index-BVOjegk2.js";import{C as Ze,V as E,b as nt,T as dt,Q as vt,c as Wt,d as F,R as Xe,e as Ve,f as ze,O as Ot,g as Ke,S as Re,h as $e,P as Oe,i as yt,j as Ce,k as Qe,l as ut,m as Ue,n as ce,o as Je,p as Ct,q as Ut,a as et,M as ft,r as ti,s as Yt,t as Jt,u as mt,v as ei,w as Dt,U as je,I as ii,F as at,x as qt,y as pt,z as si,A as te,D as ke,L as oi,E as Lt,W as ni,G as ai,H as ri,J as de,K as li,N as ue,X as hi,Y as ci,Z as di,_ as Bt,B as pe,$ as ui,a0 as pi,a1 as me,a2 as mi}from"./three.module-BdoxhAKl.js";const fe={type:"change"},ee={type:"start"},Be={type:"end"},At=new Xe,ye=new Ve,fi=Math.cos(70*ze.DEG2RAD),C=new E,Z=2*Math.PI,P={NONE:-1,ROTATE:0,DOLLY:1,PAN:2,TOUCH_ROTATE:3,TOUCH_PAN:4,TOUCH_DOLLY_PAN:5,TOUCH_DOLLY_ROTATE:6},It=1e-6;class yi extends Ze{constructor(t,e=null){super(t,e),this.state=P.NONE,this.target=new E,this.cursor=new E,this.minDistance=0,this.maxDistance=1/0,this.minZoom=0,this.maxZoom=1/0,this.minTargetRadius=0,this.maxTargetRadius=1/0,this.minPolarAngle=0,this.maxPolarAngle=Math.PI,this.minAzimuthAngle=-1/0,this.maxAzimuthAngle=1/0,this.enableDamping=!1,this.dampingFactor=.05,this.enableZoom=!0,this.zoomSpeed=1,this.enableRotate=!0,this.rotateSpeed=1,this.keyRotateSpeed=1,this.enablePan=!0,this.panSpeed=1,this.screenSpacePanning=!0,this.keyPanSpeed=7,this.zoomToCursor=!1,this.autoRotate=!1,this.autoRotateSpeed=2,this.keys={LEFT:"ArrowLeft",UP:"ArrowUp",RIGHT:"ArrowRight",BOTTOM:"ArrowDown"},this.mouseButtons={LEFT:nt.ROTATE,MIDDLE:nt.DOLLY,RIGHT:nt.PAN},this.touches={ONE:dt.ROTATE,TWO:dt.DOLLY_PAN},this.target0=this.target.clone(),this.position0=this.object.position.clone(),this.zoom0=this.object.zoom,this._cursorStyle="auto",this._domElementKeyEvents=null,this._lastPosition=new E,this._lastQuaternion=new vt,this._lastTargetPosition=new E,this._quat=new vt().setFromUnitVectors(t.up,new E(0,1,0)),this._quatInverse=this._quat.clone().invert(),this._spherical=new Wt,this._sphericalDelta=new Wt,this._scale=1,this._panOffset=new E,this._rotateStart=new F,this._rotateEnd=new F,this._rotateDelta=new F,this._panStart=new F,this._panEnd=new F,this._panDelta=new F,this._dollyStart=new F,this._dollyEnd=new F,this._dollyDelta=new F,this._dollyDirection=new E,this._mouse=new F,this._performCursorZoom=!1,this._pointers=[],this._pointerPositions={},this._controlActive=!1,this._onPointerMove=gi.bind(this),this._onPointerDown=_i.bind(this),this._onPointerUp=bi.bind(this),this._onContextMenu=Mi.bind(this),this._onMouseWheel=Si.bind(this),this._onKeyDown=Ei.bind(this),this._onTouchStart=xi.bind(this),this._onTouchMove=Ai.bind(this),this._onMouseDown=wi.bind(this),this._onMouseMove=vi.bind(this),this._interceptControlDown=Ti.bind(this),this._interceptControlUp=Pi.bind(this),this.domElement!==null&&this.connect(this.domElement),this.update()}set cursorStyle(t){this._cursorStyle=t,t==="grab"?this.domElement.style.cursor="grab":this.domElement.style.cursor="auto"}get cursorStyle(){return this._cursorStyle}connect(t){super.connect(t),this.domElement.addEventListener("pointerdown",this._onPointerDown),this.domElement.addEventListener("pointercancel",this._onPointerUp),this.domElement.addEventListener("contextmenu",this._onContextMenu),this.domElement.addEventListener("wheel",this._onMouseWheel,{passive:!1}),this.domElement.getRootNode().addEventListener("keydown",this._interceptControlDown,{passive:!0,capture:!0}),this.domElement.style.touchAction="none"}disconnect(){this.domElement.removeEventListener("pointerdown",this._onPointerDown),this.domElement.ownerDocument.removeEventListener("pointermove",this._onPointerMove),this.domElement.ownerDocument.removeEventListener("pointerup",this._onPointerUp),this.domElement.removeEventListener("pointercancel",this._onPointerUp),this.domElement.removeEventListener("wheel",this._onMouseWheel),this.domElement.removeEventListener("contextmenu",this._onContextMenu),this.stopListenToKeyEvents(),this.domElement.getRootNode().removeEventListener("keydown",this._interceptControlDown,{capture:!0}),this.domElement.style.touchAction="auto"}dispose(){this.disconnect()}getPolarAngle(){return this._spherical.phi}getAzimuthalAngle(){return this._spherical.theta}getDistance(){return this.object.position.distanceTo(this.target)}listenToKeyEvents(t){t.addEventListener("keydown",this._onKeyDown),this._domElementKeyEvents=t}stopListenToKeyEvents(){this._domElementKeyEvents!==null&&(this._domElementKeyEvents.removeEventListener("keydown",this._onKeyDown),this._domElementKeyEvents=null)}saveState(){this.target0.copy(this.target),this.position0.copy(this.object.position),this.zoom0=this.object.zoom}reset(){this.target.copy(this.target0),this.object.position.copy(this.position0),this.object.zoom=this.zoom0,this.object.updateProjectionMatrix(),this.dispatchEvent(fe),this.update(),this.state=P.NONE}pan(t,e){this._pan(t,e),this.update()}dollyIn(t){this._dollyIn(t),this.update()}dollyOut(t){this._dollyOut(t),this.update()}rotateLeft(t){this._rotateLeft(t),this.update()}rotateUp(t){this._rotateUp(t),this.update()}update(t=null){const e=this.object.position;C.copy(e).sub(this.target),C.applyQuaternion(this._quat),this._spherical.setFromVector3(C),this.autoRotate&&this.state===P.NONE&&this._rotateLeft(this._getAutoRotationAngle(t)),this.enableDamping?(this._spherical.theta+=this._sphericalDelta.theta*this.dampingFactor,this._spherical.phi+=this._sphericalDelta.phi*this.dampingFactor):(this._spherical.theta+=this._sphericalDelta.theta,this._spherical.phi+=this._sphericalDelta.phi);let i=this.minAzimuthAngle,o=this.maxAzimuthAngle;isFinite(i)&&isFinite(o)&&(i<-Math.PI?i+=Z:i>Math.PI&&(i-=Z),o<-Math.PI?o+=Z:o>Math.PI&&(o-=Z),i<=o?this._spherical.theta=Math.max(i,Math.min(o,this._spherical.theta)):this._spherical.theta=this._spherical.theta>(i+o)/2?Math.max(i,this._spherical.theta):Math.min(o,this._spherical.theta)),this._spherical.phi=Math.max(this.minPolarAngle,Math.min(this.maxPolarAngle,this._spherical.phi)),this._spherical.makeSafe(),this.enableDamping===!0?this.target.addScaledVector(this._panOffset,this.dampingFactor):this.target.add(this._panOffset),this.target.sub(this.cursor),this.target.clampLength(this.minTargetRadius,this.maxTargetRadius),this.target.add(this.cursor);let n=!1;if(this.zoomToCursor&&this._performCursorZoom||this.object.isOrthographicCamera)this._spherical.radius=this._clampDistance(this._spherical.radius);else{const r=this._spherical.radius;this._spherical.radius=this._clampDistance(this._spherical.radius*this._scale),n=r!=this._spherical.radius}if(C.setFromSpherical(this._spherical),C.applyQuaternion(this._quatInverse),e.copy(this.target).add(C),this.object.lookAt(this.target),this.enableDamping===!0?(this._sphericalDelta.theta*=1-this.dampingFactor,this._sphericalDelta.phi*=1-this.dampingFactor,this._panOffset.multiplyScalar(1-this.dampingFactor)):(this._sphericalDelta.set(0,0,0),this._panOffset.set(0,0,0)),this.zoomToCursor&&this._performCursorZoom){let r=null;if(this.object.isPerspectiveCamera){const l=C.length();r=this._clampDistance(l*this._scale);const d=l-r;this.object.position.addScaledVector(this._dollyDirection,d),this.object.updateMatrixWorld(),n=!!d}else if(this.object.isOrthographicCamera){const l=new E(this._mouse.x,this._mouse.y,0);l.unproject(this.object);const d=this.object.zoom;this.object.zoom=Math.max(this.minZoom,Math.min(this.maxZoom,this.object.zoom/this._scale)),this.object.updateProjectionMatrix(),n=d!==this.object.zoom;const m=new E(this._mouse.x,this._mouse.y,0);m.unproject(this.object),this.object.position.sub(m).add(l),this.object.updateMatrixWorld(),r=C.length()}else console.warn("WARNING: OrbitControls.js encountered an unknown camera type - zoom to cursor disabled."),this.zoomToCursor=!1;r!==null&&(this.screenSpacePanning?this.target.set(0,0,-1).transformDirection(this.object.matrix).multiplyScalar(r).add(this.object.position):(At.origin.copy(this.object.position),At.direction.set(0,0,-1).transformDirection(this.object.matrix),Math.abs(this.object.up.dot(At.direction))<fi?this.object.lookAt(this.target):(ye.setFromNormalAndCoplanarPoint(this.object.up,this.target),At.intersectPlane(ye,this.target))))}else if(this.object.isOrthographicCamera){const r=this.object.zoom;this.object.zoom=Math.max(this.minZoom,Math.min(this.maxZoom,this.object.zoom/this._scale)),r!==this.object.zoom&&(this.object.updateProjectionMatrix(),n=!0)}return this._scale=1,this._performCursorZoom=!1,n||this._lastPosition.distanceToSquared(this.object.position)>It||8*(1-this._lastQuaternion.dot(this.object.quaternion))>It||this._lastTargetPosition.distanceToSquared(this.target)>It?(this.dispatchEvent(fe),this._lastPosition.copy(this.object.position),this._lastQuaternion.copy(this.object.quaternion),this._lastTargetPosition.copy(this.target),!0):!1}_getAutoRotationAngle(t){return t!==null?Z/60*this.autoRotateSpeed*t:Z/60/60*this.autoRotateSpeed}_getZoomScale(t){const e=Math.abs(t*.01);return Math.pow(.95,this.zoomSpeed*e)}_rotateLeft(t){this._sphericalDelta.theta-=t}_rotateUp(t){this._sphericalDelta.phi-=t}_panLeft(t,e){C.setFromMatrixColumn(e,0),C.multiplyScalar(-t),this._panOffset.add(C)}_panUp(t,e){this.screenSpacePanning===!0?C.setFromMatrixColumn(e,1):(C.setFromMatrixColumn(e,0),C.crossVectors(this.object.up,C)),C.multiplyScalar(t),this._panOffset.add(C)}_pan(t,e){const i=this.domElement;if(this.object.isPerspectiveCamera){const o=this.object.position;C.copy(o).sub(this.target);let n=C.length();n*=Math.tan(this.object.fov/2*Math.PI/180),this._panLeft(2*t*n/i.clientHeight,this.object.matrix),this._panUp(2*e*n/i.clientHeight,this.object.matrix)}else this.object.isOrthographicCamera?(this._panLeft(t*(this.object.right-this.object.left)/this.object.zoom/i.clientWidth,this.object.matrix),this._panUp(e*(this.object.top-this.object.bottom)/this.object.zoom/i.clientHeight,this.object.matrix)):(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - pan disabled."),this.enablePan=!1)}_dollyOut(t){this.object.isPerspectiveCamera||this.object.isOrthographicCamera?this._scale/=t:(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled."),this.enableZoom=!1)}_dollyIn(t){this.object.isPerspectiveCamera||this.object.isOrthographicCamera?this._scale*=t:(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled."),this.enableZoom=!1)}_updateZoomParameters(t,e){if(!this.zoomToCursor)return;this._performCursorZoom=!0;const i=this.domElement.getBoundingClientRect(),o=t-i.left,n=e-i.top,r=i.width,l=i.height;this._mouse.x=o/r*2-1,this._mouse.y=-(n/l)*2+1,this._dollyDirection.set(this._mouse.x,this._mouse.y,1).unproject(this.object).sub(this.object.position).normalize()}_clampDistance(t){return Math.max(this.minDistance,Math.min(this.maxDistance,t))}_handleMouseDownRotate(t){this._rotateStart.set(t.clientX,t.clientY)}_handleMouseDownDolly(t){this._updateZoomParameters(t.clientX,t.clientX),this._dollyStart.set(t.clientX,t.clientY)}_handleMouseDownPan(t){this._panStart.set(t.clientX,t.clientY)}_handleMouseMoveRotate(t){this._rotateEnd.set(t.clientX,t.clientY),this._rotateDelta.subVectors(this._rotateEnd,this._rotateStart).multiplyScalar(this.rotateSpeed);const e=this.domElement;this._rotateLeft(Z*this._rotateDelta.x/e.clientHeight),this._rotateUp(Z*this._rotateDelta.y/e.clientHeight),this._rotateStart.copy(this._rotateEnd),this.update()}_handleMouseMoveDolly(t){this._dollyEnd.set(t.clientX,t.clientY),this._dollyDelta.subVectors(this._dollyEnd,this._dollyStart),this._dollyDelta.y>0?this._dollyOut(this._getZoomScale(this._dollyDelta.y)):this._dollyDelta.y<0&&this._dollyIn(this._getZoomScale(this._dollyDelta.y)),this._dollyStart.copy(this._dollyEnd),this.update()}_handleMouseMovePan(t){this._panEnd.set(t.clientX,t.clientY),this._panDelta.subVectors(this._panEnd,this._panStart).multiplyScalar(this.panSpeed),this._pan(this._panDelta.x,this._panDelta.y),this._panStart.copy(this._panEnd),this.update()}_handleMouseWheel(t){this._updateZoomParameters(t.clientX,t.clientY),t.deltaY<0?this._dollyIn(this._getZoomScale(t.deltaY)):t.deltaY>0&&this._dollyOut(this._getZoomScale(t.deltaY)),this.update()}_handleKeyDown(t){let e=!1;switch(t.code){case this.keys.UP:t.ctrlKey||t.metaKey||t.shiftKey?this.enableRotate&&this._rotateUp(Z*this.keyRotateSpeed/this.domElement.clientHeight):this.enablePan&&this._pan(0,this.keyPanSpeed),e=!0;break;case this.keys.BOTTOM:t.ctrlKey||t.metaKey||t.shiftKey?this.enableRotate&&this._rotateUp(-Z*this.keyRotateSpeed/this.domElement.clientHeight):this.enablePan&&this._pan(0,-this.keyPanSpeed),e=!0;break;case this.keys.LEFT:t.ctrlKey||t.metaKey||t.shiftKey?this.enableRotate&&this._rotateLeft(Z*this.keyRotateSpeed/this.domElement.clientHeight):this.enablePan&&this._pan(this.keyPanSpeed,0),e=!0;break;case this.keys.RIGHT:t.ctrlKey||t.metaKey||t.shiftKey?this.enableRotate&&this._rotateLeft(-Z*this.keyRotateSpeed/this.domElement.clientHeight):this.enablePan&&this._pan(-this.keyPanSpeed,0),e=!0;break}e&&(t.preventDefault(),this.update())}_handleTouchStartRotate(t){if(this._pointers.length===1)this._rotateStart.set(t.pageX,t.pageY);else{const e=this._getSecondPointerPosition(t),i=.5*(t.pageX+e.x),o=.5*(t.pageY+e.y);this._rotateStart.set(i,o)}}_handleTouchStartPan(t){if(this._pointers.length===1)this._panStart.set(t.pageX,t.pageY);else{const e=this._getSecondPointerPosition(t),i=.5*(t.pageX+e.x),o=.5*(t.pageY+e.y);this._panStart.set(i,o)}}_handleTouchStartDolly(t){const e=this._getSecondPointerPosition(t),i=t.pageX-e.x,o=t.pageY-e.y,n=Math.sqrt(i*i+o*o);this._dollyStart.set(0,n)}_handleTouchStartDollyPan(t){this.enableZoom&&this._handleTouchStartDolly(t),this.enablePan&&this._handleTouchStartPan(t)}_handleTouchStartDollyRotate(t){this.enableZoom&&this._handleTouchStartDolly(t),this.enableRotate&&this._handleTouchStartRotate(t)}_handleTouchMoveRotate(t){if(this._pointers.length==1)this._rotateEnd.set(t.pageX,t.pageY);else{const i=this._getSecondPointerPosition(t),o=.5*(t.pageX+i.x),n=.5*(t.pageY+i.y);this._rotateEnd.set(o,n)}this._rotateDelta.subVectors(this._rotateEnd,this._rotateStart).multiplyScalar(this.rotateSpeed);const e=this.domElement;this._rotateLeft(Z*this._rotateDelta.x/e.clientHeight),this._rotateUp(Z*this._rotateDelta.y/e.clientHeight),this._rotateStart.copy(this._rotateEnd)}_handleTouchMovePan(t){if(this._pointers.length===1)this._panEnd.set(t.pageX,t.pageY);else{const e=this._getSecondPointerPosition(t),i=.5*(t.pageX+e.x),o=.5*(t.pageY+e.y);this._panEnd.set(i,o)}this._panDelta.subVectors(this._panEnd,this._panStart).multiplyScalar(this.panSpeed),this._pan(this._panDelta.x,this._panDelta.y),this._panStart.copy(this._panEnd)}_handleTouchMoveDolly(t){const e=this._getSecondPointerPosition(t),i=t.pageX-e.x,o=t.pageY-e.y,n=Math.sqrt(i*i+o*o);this._dollyEnd.set(0,n),this._dollyDelta.set(0,Math.pow(this._dollyEnd.y/this._dollyStart.y,this.zoomSpeed)),this._dollyOut(this._dollyDelta.y),this._dollyStart.copy(this._dollyEnd);const r=(t.pageX+e.x)*.5,l=(t.pageY+e.y)*.5;this._updateZoomParameters(r,l)}_handleTouchMoveDollyPan(t){this.enableZoom&&this._handleTouchMoveDolly(t),this.enablePan&&this._handleTouchMovePan(t)}_handleTouchMoveDollyRotate(t){this.enableZoom&&this._handleTouchMoveDolly(t),this.enableRotate&&this._handleTouchMoveRotate(t)}_addPointer(t){this._pointers.push(t.pointerId)}_removePointer(t){delete this._pointerPositions[t.pointerId];for(let e=0;e<this._pointers.length;e++)if(this._pointers[e]==t.pointerId){this._pointers.splice(e,1);return}}_isTrackingPointer(t){for(let e=0;e<this._pointers.length;e++)if(this._pointers[e]==t.pointerId)return!0;return!1}_trackPointer(t){let e=this._pointerPositions[t.pointerId];e===void 0&&(e=new F,this._pointerPositions[t.pointerId]=e),e.set(t.pageX,t.pageY)}_getSecondPointerPosition(t){const e=t.pointerId===this._pointers[0]?this._pointers[1]:this._pointers[0];return this._pointerPositions[e]}_customWheelEvent(t){const e=t.deltaMode,i={clientX:t.clientX,clientY:t.clientY,deltaY:t.deltaY};switch(e){case 1:i.deltaY*=16;break;case 2:i.deltaY*=100;break}return t.ctrlKey&&!this._controlActive&&(i.deltaY*=10),i}}function _i(s){this.enabled!==!1&&(this._pointers.length===0&&(this.domElement.setPointerCapture(s.pointerId),this.domElement.ownerDocument.addEventListener("pointermove",this._onPointerMove),this.domElement.ownerDocument.addEventListener("pointerup",this._onPointerUp)),!this._isTrackingPointer(s)&&(this._addPointer(s),s.pointerType==="touch"?this._onTouchStart(s):this._onMouseDown(s),this._cursorStyle==="grab"&&(this.domElement.style.cursor="grabbing")))}function gi(s){this.enabled!==!1&&(s.pointerType==="touch"?this._onTouchMove(s):this._onMouseMove(s))}function bi(s){switch(this._removePointer(s),this._pointers.length){case 0:this.domElement.releasePointerCapture(s.pointerId),this.domElement.ownerDocument.removeEventListener("pointermove",this._onPointerMove),this.domElement.ownerDocument.removeEventListener("pointerup",this._onPointerUp),this.dispatchEvent(Be),this.state=P.NONE,this._cursorStyle==="grab"&&(this.domElement.style.cursor="grab");break;case 1:const t=this._pointers[0],e=this._pointerPositions[t];this._onTouchStart({pointerId:t,pageX:e.x,pageY:e.y});break}}function wi(s){let t;switch(s.button){case 0:t=this.mouseButtons.LEFT;break;case 1:t=this.mouseButtons.MIDDLE;break;case 2:t=this.mouseButtons.RIGHT;break;default:t=-1}switch(t){case nt.DOLLY:if(this.enableZoom===!1)return;this._handleMouseDownDolly(s),this.state=P.DOLLY;break;case nt.ROTATE:if(s.ctrlKey||s.metaKey||s.shiftKey){if(this.enablePan===!1)return;this._handleMouseDownPan(s),this.state=P.PAN}else{if(this.enableRotate===!1)return;this._handleMouseDownRotate(s),this.state=P.ROTATE}break;case nt.PAN:if(s.ctrlKey||s.metaKey||s.shiftKey){if(this.enableRotate===!1)return;this._handleMouseDownRotate(s),this.state=P.ROTATE}else{if(this.enablePan===!1)return;this._handleMouseDownPan(s),this.state=P.PAN}break;default:this.state=P.NONE}this.state!==P.NONE&&this.dispatchEvent(ee)}function vi(s){switch(this.state){case P.ROTATE:if(this.enableRotate===!1)return;this._handleMouseMoveRotate(s);break;case P.DOLLY:if(this.enableZoom===!1)return;this._handleMouseMoveDolly(s);break;case P.PAN:if(this.enablePan===!1)return;this._handleMouseMovePan(s);break}}function Si(s){this.enabled===!1||this.enableZoom===!1||this.state!==P.NONE||(s.preventDefault(),this.dispatchEvent(ee),this._handleMouseWheel(this._customWheelEvent(s)),this.dispatchEvent(Be))}function Ei(s){this.enabled!==!1&&this._handleKeyDown(s)}function xi(s){switch(this._trackPointer(s),this._pointers.length){case 1:switch(this.touches.ONE){case dt.ROTATE:if(this.enableRotate===!1)return;this._handleTouchStartRotate(s),this.state=P.TOUCH_ROTATE;break;case dt.PAN:if(this.enablePan===!1)return;this._handleTouchStartPan(s),this.state=P.TOUCH_PAN;break;default:this.state=P.NONE}break;case 2:switch(this.touches.TWO){case dt.DOLLY_PAN:if(this.enableZoom===!1&&this.enablePan===!1)return;this._handleTouchStartDollyPan(s),this.state=P.TOUCH_DOLLY_PAN;break;case dt.DOLLY_ROTATE:if(this.enableZoom===!1&&this.enableRotate===!1)return;this._handleTouchStartDollyRotate(s),this.state=P.TOUCH_DOLLY_ROTATE;break;default:this.state=P.NONE}break;default:this.state=P.NONE}this.state!==P.NONE&&this.dispatchEvent(ee)}function Ai(s){switch(this._trackPointer(s),this.state){case P.TOUCH_ROTATE:if(this.enableRotate===!1)return;this._handleTouchMoveRotate(s),this.update();break;case P.TOUCH_PAN:if(this.enablePan===!1)return;this._handleTouchMovePan(s),this.update();break;case P.TOUCH_DOLLY_PAN:if(this.enableZoom===!1&&this.enablePan===!1)return;this._handleTouchMoveDollyPan(s),this.update();break;case P.TOUCH_DOLLY_ROTATE:if(this.enableZoom===!1&&this.enableRotate===!1)return;this._handleTouchMoveDollyRotate(s),this.update();break;default:this.state=P.NONE}}function Mi(s){this.enabled!==!1&&s.preventDefault()}function Ti(s){s.key==="Control"&&(this._controlActive=!0,this.domElement.getRootNode().addEventListener("keyup",this._interceptControlUp,{passive:!0,capture:!0}))}function Pi(s){s.key==="Control"&&(this._controlActive=!1,this.domElement.getRootNode().removeEventListener("keyup",this._interceptControlUp,{passive:!0,capture:!0}))}var Di=Object.defineProperty,Li=(s,t,e)=>t in s?Di(s,t,{enumerable:!0,configurable:!0,writable:!0,value:e}):s[t]=e,M=(s,t,e)=>Li(s,typeof t!="symbol"?t+"":t,e);const Ie=(s,t)=>{const[e,i]=t.split("-");return Object.assign(s.style,{left:i==="left"?"0":i==="center"?"50%":"",right:i==="right"?"0":"",top:e==="top"?"0":e==="bottom"?"":"50%",bottom:e==="bottom"?"0":"",transform:`${i==="center"?"translateX(-50%)":""} ${e==="center"?"translateY(-50%)":""}`}),t},zi=({placement:s,size:t,offset:e,id:i,className:o})=>{const n=document.createElement("div"),{top:r,left:l,right:d,bottom:m}=e;return Object.assign(n.style,{id:i,position:"absolute",zIndex:"1000",height:`${t}px`,width:`${t}px`,margin:`${r}px ${d}px ${m}px ${l}px`,borderRadius:"100%"}),Ie(n,s),i&&(n.id=i),o&&(n.className=o),n},Ri=s=>{const t=typeof s=="string"?document.querySelector(s):s;if(!t)throw Error("Invalid DOM element");return t};function Zt(s,t,e){return Math.max(t,Math.min(e,s))}const Oi=[["x",0,3],["y",1,4],["z",2,5]],_e=new E;function ge({isSphere:s},t,e){s&&(_e.set(0,0,1).applyQuaternion(e.quaternion),Oi.forEach(([i,o,n])=>{const r=_e[i];let l=t[o],d=l.userData.opacity;l.material.opacity=Zt(r>=0?d:d/2,0,1),l=t[n],d=l.userData.opacity,l.material.opacity=Zt(r>=0?d/2:d,0,1)}))}const Ci=(s,t,e=10)=>Math.abs(s.clientX-t.x)<e&&Math.abs(s.clientY-t.y)<e,be=new Qe,we=new F,ve=(s,t,e,i)=>{we.set((s.clientX-t.left)/t.width*2-1,-((s.clientY-t.top)/t.height)*2+1),be.setFromCamera(we,e);const o=be.intersectObjects(i,!1),n=o.length?o[0]:null;return!n||!n.object.visible?null:n},Nt=1e-6,Ui=2*Math.PI,Ne=["x","y","z"],St=[...Ne,"nx","ny","nz"],ji=["x","z","y","nx","nz","ny"],ki=["z","x","y","nz","nx","ny"],Xt="Right",zt="Top",Vt="Front",Kt="Left",Rt="Bottom",$t="Back",Bi=[Xt,zt,Vt,Kt,Rt,$t].map(s=>s.toLocaleLowerCase()),He=1.3,Se=(s,t=!0)=>{const{material:e,userData:i}=s,{color:o,opacity:n}=t?i.hover:i;e.color.set(o),e.opacity=n},rt=s=>JSON.parse(JSON.stringify(s)),Ii=s=>{const t=s.type||"sphere",e=t==="sphere",i=s.resolution||e?64:128,o=Ot.DEFAULT_UP,n=o.z===1,r=o.x===1,{container:l}=s;s.container=void 0,s=JSON.parse(JSON.stringify(s)),s.container=l;const d=n?ji:r?ki:St;Bi.forEach((h,u)=>{s[h]&&(s[d[u]]=s[h])});const m={enabled:!0,color:16777215,opacity:1,scale:.7,labelColor:2236962,line:!1,border:{size:0,color:14540253},hover:{color:e?16777215:9688043,labelColor:2236962,opacity:1,scale:.7,border:{size:0,color:14540253}}},a={line:!1,scale:e?.45:.7,hover:{scale:e?.5:.7}},c={type:t,container:document.body,size:128,placement:"top-right",resolution:i,lineWidth:4,radius:e?1:.2,smoothness:18,animated:!0,speed:1,background:{enabled:!0,color:e?16777215:14739180,opacity:e?0:1,hover:{color:e?16777215:14739180,opacity:e?.2:1}},font:{family:"sans-serif",weight:900},offset:{top:10,left:10,bottom:10,right:10},corners:{enabled:!e,color:e?15915362:16777215,opacity:1,scale:e?.15:.2,radius:1,smoothness:18,hover:{color:e?16777215:9688043,opacity:1,scale:e?.2:.225}},edges:{enabled:!e,color:e?15915362:16777215,opacity:e?1:0,radius:e?1:.125,smoothness:18,scale:e?.15:1,hover:{color:e?16777215:9688043,opacity:1,scale:e?.2:1}},x:{...rt(m),...e?{label:"X",color:16725587,line:!0}:{label:r?zt:Xt}},y:{...rt(m),...e?{label:"Y",color:9100032,line:!0}:{label:n||r?Vt:zt}},z:{...rt(m),...e?{label:"Z",color:2920447,line:!0}:{label:n?zt:r?Xt:Vt}},nx:{...rt(a),label:e?"":r?Rt:Kt},ny:{...rt(a),label:e?"":n||r?$t:Rt},nz:{...rt(a),label:e?"":n?Rt:r?Kt:$t}};return Qt(s,c),Ne.forEach(h=>Qt(s[`n${h}`],rt(s[h]))),{...s,isSphere:e}};function Qt(s,...t){if(s instanceof HTMLElement||typeof s!="object"||s===null)return s;for(const e of t)for(const i in e)i!=="container"&&i in e&&(s[i]===void 0?s[i]=e[i]:typeof e[i]=="object"&&!Array.isArray(e[i])&&(s[i]=Qt(s[i]||{},e[i])));return s}const Ni=(s,t=2)=>{const e=new ut,i=t*2,{isSphere:o,resolution:n,radius:r,font:l,corners:d,edges:m}=s,a=St.map(_=>({...s[_],radius:r}));o&&d.enabled&&a.push(d),o&&m.enabled&&a.push(m);const c=document.createElement("canvas"),h=c.getContext("2d");c.width=n*2+i*2,c.height=n*a.length+i*a.length;const[u,f]=K(a,n,l);a.forEach(({radius:_,label:x,color:I,labelColor:v,border:b,hover:{color:X,labelColor:R,border:U}},G)=>{const p=n*G+G*i+t;w(t,p,t,n,_,x,b,I,v),w(n+t*3,p,t,n,_,x,U??b,X??I,R??v)});const A=a.length,T=t/(n*2),g=t/(n*6),y=1/A,z=new Ue(c);return z.repeat.set(.5-2*T,y-2*g),z.offset.set(T,1-g),Object.assign(z,{colorSpace:Je,wrapS:ce,wrapT:ce,userData:{offsetX:T,offsetY:g,cellHeight:y}}),z;function w(_,x,I,v,b,X,R,U,G){if(b=b*(v/2),U!=null&&U!==""&&(p(),h.fillStyle=e.set(U).getStyle(),h.fill()),R&&R.size){const S=R.size*v/2;_+=S,x+=S,v-=R.size*v,b=Math.max(0,b-S),p(),h.strokeStyle=e.set(R.color).getStyle(),h.lineWidth=R.size*v,h.stroke()}X&&D(h,_+v/2,x+(v+I)/2,X,e.set(G).getStyle());function p(){h.beginPath(),h.moveTo(_+b,x),h.lineTo(_+v-b,x),h.arcTo(_+v,x,_+v,x+b,b),h.lineTo(_+v,x+v-b),h.arcTo(_+v,x+v,_+v-b,x+v,b),h.lineTo(_+b,x+v),h.arcTo(_,x+v,_,x+v-b,b),h.lineTo(_,x+b),h.arcTo(_,x,_+b,x,b),h.closePath()}}function K(_,x,I){const v=[..._].sort((O,$)=>{var V,W;return(((V=O.label)==null?void 0:V.length)||0)-(((W=$.label)==null?void 0:W.length)||0)}).pop().label,{family:b,weight:X}=I,R=o?Math.sqrt(Math.pow(x*.7,2)/2):x;let U=R,G=0,p=0;do{h.font=`${X} ${U}px ${b}`;const O=h.measureText(v);G=O.width,p=O.fontBoundingBoxDescent,U--}while(G>R&&U>0);const S=R/p,N=Math.min(R/G,S),L=Math.floor(U*N);return[`${X} ${L}px ${b}`,S]}function D(_,x,I,v,b){_.font=u,_.textAlign="center",_.textBaseline="middle",_.fillStyle=b,_.fillText(v,x,I+(o?f:0))}},Hi=(s,t)=>s.offset.x=(t?.5:0)+s.userData.offsetX,ie=(s,t)=>{const{offset:e,userData:{offsetY:i,cellHeight:o}}=s;e.y=1-(t+1)*o+i};function se(s,t,e=2,i=2){const o=e/2-s,n=i/2-s,r=s/e,l=(e-s)/e,d=s/i,m=(i-s)/i,a=[o,n,0,-o,n,0,-o,-n,0,o,-n,0],c=[l,m,r,m,r,d,l,d],h=[3*(t+1)+3,3*(t+1)+4,t+4,t+5,2*(t+1)+4,2,1,2*(t+1)+3,3,4*(t+1)+3,4,0],u=[0,1,2,0,2,3,4,5,6,4,6,7,8,9,10,8,10,11].map(D=>h[D]);let f,A,T,g,y,z,w,K;for(let D=0;D<4;D++){g=D<1||D>2?o:-o,y=D<2?n:-n,z=D<1||D>2?l:r,w=D<2?m:d;for(let _=0;_<=t;_++)f=Math.PI/2*(D+_/t),A=Math.cos(f),T=Math.sin(f),a.push(g+s*A,y+s*T,0),c.push(z+r*A,w+d*T),_<t&&(K=(t+1)*D+_+4,u.push(D,K,K+1))}return new Jt().setIndex(new mt(new Uint32Array(u),1)).setAttribute("position",new mt(new Float32Array(a),3)).setAttribute("uv",new mt(new Float32Array(c),2))}const Fi=(s,t)=>{const e=new E,{isSphere:i,radius:o,smoothness:n}=s,r=se(o,n);return St.map((l,d)=>{const m=d<3,a=St[d],c=d?t.clone():t;ie(c,d);const{enabled:h,scale:u,opacity:f,hover:A}=s[a],T={map:c,opacity:f,transparent:!0},g=i?new Ct(new Ut(T)):new et(r,new ft(T)),y=m?a:a[1];return g.position[y]=(m?1:-1)*(i?He:1),i||g.lookAt(e.copy(g.position).multiplyScalar(1.7)),g.scale.setScalar(u),g.renderOrder=1,g.visible=h,g.userData={scale:u,opacity:f,hover:A},g})},Gi=(s,t)=>{const{isSphere:e,corners:i}=s;if(!i.enabled)return[];const{color:o,opacity:n,scale:r,radius:l,smoothness:d,hover:m}=i,a=e?null:se(l,d),c={transparent:!0,opacity:n},h=[1,1,1,-1,1,1,1,-1,1,-1,-1,1,1,1,-1,-1,1,-1,1,-1,-1,-1,-1,-1].map(f=>f*.85),u=new E;return Array(h.length/3).fill(0).map((f,A)=>{if(e){const y=t.clone();ie(y,6),c.map=y}else c.color=o;const T=e?new Ct(new Ut(c)):new et(a,new ft(c)),g=A*3;return T.position.set(h[g],h[g+1],h[g+2]),e&&T.position.normalize().multiplyScalar(1.7),T.scale.setScalar(r),T.lookAt(u.copy(T.position).multiplyScalar(2)),T.renderOrder=1,T.userData={color:o,opacity:n,scale:r,hover:m},T})},Wi=(s,t,e)=>{const{isSphere:i,edges:o}=s;if(!o.enabled)return[];const{color:n,opacity:r,scale:l,hover:d,radius:m,smoothness:a}=o,c=i?null:se(m,a,1.2,.25),h={transparent:!0,opacity:r},u=[0,1,1,0,-1,1,1,0,1,-1,0,1,0,1,-1,0,-1,-1,1,0,-1,-1,0,-1,1,1,0,1,-1,0,-1,1,0,-1,-1,0].map(T=>T*.925),f=new E,A=new E(0,1,0);return Array(u.length/3).fill(0).map((T,g)=>{if(i){const w=t.clone();ie(w,e),h.map=w}else h.color=n;const y=i?new Ct(new Ut(h)):new et(c,new ft(h)),z=g*3;return y.position.set(u[z],u[z+1],u[z+2]),i&&y.position.normalize().multiplyScalar(1.7),y.scale.setScalar(l),y.up.copy(A),y.lookAt(f.copy(y.position).multiplyScalar(2)),!i&&!y.position.y&&(y.rotation.z=Math.PI/2),y.renderOrder=1,y.userData={color:n,opacity:r,scale:l,hover:d},y})};function Yi(s,t=!1){const e=s[0].index!==null,i=new Set(Object.keys(s[0].attributes)),o=new Set(Object.keys(s[0].morphAttributes)),n={},r={},l=s[0].morphTargetsRelative,d=new Jt;let m=0;for(let a=0;a<s.length;++a){const c=s[a];let h=0;if(e!==(c.index!==null))return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index "+a+". All geometries must have compatible attributes; make sure index attribute exists among all geometries, or in none of them."),null;for(const u in c.attributes){if(!i.has(u))return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index "+a+'. All geometries must have compatible attributes; make sure "'+u+'" attribute exists among all geometries, or in none of them.'),null;n[u]===void 0&&(n[u]=[]),n[u].push(c.attributes[u]),h++}if(h!==i.size)return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index "+a+". Make sure all geometries have the same number of attributes."),null;if(l!==c.morphTargetsRelative)return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index "+a+". .morphTargetsRelative must be consistent throughout all geometries."),null;for(const u in c.morphAttributes){if(!o.has(u))return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index "+a+".  .morphAttributes must be consistent throughout all geometries."),null;r[u]===void 0&&(r[u]=[]),r[u].push(c.morphAttributes[u])}if(t){let u;if(e)u=c.index.count;else if(c.attributes.position!==void 0)u=c.attributes.position.count;else return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index "+a+". The geometry must have either an index or a position attribute"),null;d.addGroup(m,u,a),m+=u}}if(e){let a=0;const c=[];for(let h=0;h<s.length;++h){const u=s[h].index;for(let f=0;f<u.count;++f)c.push(u.getX(f)+a);a+=s[h].attributes.position.count}d.setIndex(c)}for(const a in n){const c=Ee(n[a]);if(!c)return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed while trying to merge the "+a+" attribute."),null;d.setAttribute(a,c)}for(const a in r){const c=r[a][0].length;if(c===0)break;d.morphAttributes=d.morphAttributes||{},d.morphAttributes[a]=[];for(let h=0;h<c;++h){const u=[];for(let A=0;A<r[a].length;++A)u.push(r[a][A][h]);const f=Ee(u);if(!f)return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed while trying to merge the "+a+" morphAttribute."),null;d.morphAttributes[a].push(f)}}return d}function Ee(s){let t,e,i,o=-1,n=0;for(let m=0;m<s.length;++m){const a=s[m];if(t===void 0&&(t=a.array.constructor),t!==a.array.constructor)return console.error("THREE.BufferGeometryUtils: .mergeAttributes() failed. BufferAttribute.array must be of consistent array types across matching attributes."),null;if(e===void 0&&(e=a.itemSize),e!==a.itemSize)return console.error("THREE.BufferGeometryUtils: .mergeAttributes() failed. BufferAttribute.itemSize must be consistent across matching attributes."),null;if(i===void 0&&(i=a.normalized),i!==a.normalized)return console.error("THREE.BufferGeometryUtils: .mergeAttributes() failed. BufferAttribute.normalized must be consistent across matching attributes."),null;if(o===-1&&(o=a.gpuType),o!==a.gpuType)return console.error("THREE.BufferGeometryUtils: .mergeAttributes() failed. BufferAttribute.gpuType must be consistent across matching attributes."),null;n+=a.count*e}const r=new t(n),l=new mt(r,e,i);let d=0;for(let m=0;m<s.length;++m){const a=s[m];if(a.isInterleavedBufferAttribute){const c=d/e;for(let h=0,u=a.count;h<u;h++)for(let f=0;f<e;f++){const A=a.getComponent(h,f);l.setComponent(h+c,f,A)}}else r.set(a.array,d);d+=a.count*e}return o!==void 0&&(l.gpuType=o),l}const qi=(s,t)=>{const{isSphere:e,background:{enabled:i,color:o,opacity:n,hover:r}}=t;let l;const d=new ft({color:o,side:ti,opacity:n,transparent:!0,depthWrite:!1});if(!i)return null;if(e)l=new et(new Yt(1.8,64,64),d);else{let m;s.forEach(a=>{const c=a.scale.x;a.scale.setScalar(.9),a.updateMatrix();const h=a.geometry.clone();h.applyMatrix4(a.matrix),m=m?Yi([m,h]):h,a.scale.setScalar(c)}),l=new et(m,d)}return l.userData={color:o,opacity:n,hover:r},l},xe=new te,Mt=new E;class Fe extends ii{constructor(){super(),this.isLineSegmentsGeometry=!0,this.type="LineSegmentsGeometry";const t=[-1,2,0,1,2,0,-1,1,0,1,1,0,-1,0,0,1,0,0,-1,-1,0,1,-1,0],e=[-1,2,1,2,-1,1,1,1,-1,-1,1,-1,-1,-2,1,-2],i=[0,2,1,2,3,1,2,4,3,4,5,3,4,6,5,6,7,5];this.setIndex(i),this.setAttribute("position",new at(t,3)),this.setAttribute("uv",new at(e,2))}applyMatrix4(t){const e=this.attributes.instanceStart,i=this.attributes.instanceEnd;return e!==void 0&&(e.applyMatrix4(t),i.applyMatrix4(t),e.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}setPositions(t){let e;t instanceof Float32Array?e=t:Array.isArray(t)&&(e=new Float32Array(t));const i=new qt(e,6,1);return this.setAttribute("instanceStart",new pt(i,3,0)),this.setAttribute("instanceEnd",new pt(i,3,3)),this.instanceCount=this.attributes.instanceStart.count,this.computeBoundingBox(),this.computeBoundingSphere(),this}setColors(t){let e;t instanceof Float32Array?e=t:Array.isArray(t)&&(e=new Float32Array(t));const i=new qt(e,6,1);return this.setAttribute("instanceColorStart",new pt(i,3,0)),this.setAttribute("instanceColorEnd",new pt(i,3,3)),this}fromWireframeGeometry(t){return this.setPositions(t.attributes.position.array),this}fromEdgesGeometry(t){return this.setPositions(t.attributes.position.array),this}fromMesh(t){return this.fromWireframeGeometry(new si(t.geometry)),this}fromLineSegments(t){const e=t.geometry;return this.setPositions(e.attributes.position.array),this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new te);const t=this.attributes.instanceStart,e=this.attributes.instanceEnd;t!==void 0&&e!==void 0&&(this.boundingBox.setFromBufferAttribute(t),xe.setFromBufferAttribute(e),this.boundingBox.union(xe))}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new ke),this.boundingBox===null&&this.computeBoundingBox();const t=this.attributes.instanceStart,e=this.attributes.instanceEnd;if(t!==void 0&&e!==void 0){const i=this.boundingSphere.center;this.boundingBox.getCenter(i);let o=0;for(let n=0,r=t.count;n<r;n++)Mt.fromBufferAttribute(t,n),o=Math.max(o,i.distanceToSquared(Mt)),Mt.fromBufferAttribute(e,n),o=Math.max(o,i.distanceToSquared(Mt));this.boundingSphere.radius=Math.sqrt(o),isNaN(this.boundingSphere.radius)&&console.error("THREE.LineSegmentsGeometry.computeBoundingSphere(): Computed radius is NaN. The instanced position data is likely to have NaN values.",this)}}toJSON(){}applyMatrix(t){return console.warn("THREE.LineSegmentsGeometry: applyMatrix() has been renamed to applyMatrix4()."),this.applyMatrix4(t)}}Lt.line={worldUnits:{value:1},linewidth:{value:1},resolution:{value:new F(1,1)},dashOffset:{value:0},dashScale:{value:1},dashSize:{value:1},gapSize:{value:1}};Dt.line={uniforms:je.merge([Lt.common,Lt.fog,Lt.line]),vertexShader:`
		#include <common>
		#include <color_pars_vertex>
		#include <fog_pars_vertex>
		#include <logdepthbuf_pars_vertex>
		#include <clipping_planes_pars_vertex>

		uniform float linewidth;
		uniform vec2 resolution;

		attribute vec3 instanceStart;
		attribute vec3 instanceEnd;

		attribute vec3 instanceColorStart;
		attribute vec3 instanceColorEnd;

		#ifdef WORLD_UNITS

			varying vec4 worldPos;
			varying vec3 worldStart;
			varying vec3 worldEnd;

			#ifdef USE_DASH

				varying vec2 vUv;

			#endif

		#else

			varying vec2 vUv;

		#endif

		#ifdef USE_DASH

			uniform float dashScale;
			attribute float instanceDistanceStart;
			attribute float instanceDistanceEnd;
			varying float vLineDistance;

		#endif

		void trimSegment( const in vec4 start, inout vec4 end ) {

			// trim end segment so it terminates between the camera plane and the near plane

			// conservative estimate of the near plane
			float a = projectionMatrix[ 2 ][ 2 ]; // 3nd entry in 3th column
			float b = projectionMatrix[ 3 ][ 2 ]; // 3nd entry in 4th column
			float nearEstimate = - 0.5 * b / a;

			float alpha = ( nearEstimate - start.z ) / ( end.z - start.z );

			end.xyz = mix( start.xyz, end.xyz, alpha );

		}

		void main() {

			#ifdef USE_COLOR

				vColor.xyz = ( position.y < 0.5 ) ? instanceColorStart : instanceColorEnd;

			#endif

			#ifdef USE_DASH

				vLineDistance = ( position.y < 0.5 ) ? dashScale * instanceDistanceStart : dashScale * instanceDistanceEnd;
				vUv = uv;

			#endif

			float aspect = resolution.x / resolution.y;

			// camera space
			vec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );
			vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );

			#ifdef WORLD_UNITS

				worldStart = start.xyz;
				worldEnd = end.xyz;

			#else

				vUv = uv;

			#endif

			// special case for perspective projection, and segments that terminate either in, or behind, the camera plane
			// clearly the gpu firmware has a way of addressing this issue when projecting into ndc space
			// but we need to perform ndc-space calculations in the shader, so we must address this issue directly
			// perhaps there is a more elegant solution -- WestLangley

			bool perspective = ( projectionMatrix[ 2 ][ 3 ] == - 1.0 ); // 4th entry in the 3rd column

			if ( perspective ) {

				if ( start.z < 0.0 && end.z >= 0.0 ) {

					trimSegment( start, end );

				} else if ( end.z < 0.0 && start.z >= 0.0 ) {

					trimSegment( end, start );

				}

			}

			// clip space
			vec4 clipStart = projectionMatrix * start;
			vec4 clipEnd = projectionMatrix * end;

			// ndc space
			vec3 ndcStart = clipStart.xyz / clipStart.w;
			vec3 ndcEnd = clipEnd.xyz / clipEnd.w;

			// direction
			vec2 dir = ndcEnd.xy - ndcStart.xy;

			// account for clip-space aspect ratio
			dir.x *= aspect;
			dir = normalize( dir );

			#ifdef WORLD_UNITS

				vec3 worldDir = normalize( end.xyz - start.xyz );
				vec3 tmpFwd = normalize( mix( start.xyz, end.xyz, 0.5 ) );
				vec3 worldUp = normalize( cross( worldDir, tmpFwd ) );
				vec3 worldFwd = cross( worldDir, worldUp );
				worldPos = position.y < 0.5 ? start: end;

				// height offset
				float hw = linewidth * 0.5;
				worldPos.xyz += position.x < 0.0 ? hw * worldUp : - hw * worldUp;

				// don't extend the line if we're rendering dashes because we
				// won't be rendering the endcaps
				#ifndef USE_DASH

					// cap extension
					worldPos.xyz += position.y < 0.5 ? - hw * worldDir : hw * worldDir;

					// add width to the box
					worldPos.xyz += worldFwd * hw;

					// endcaps
					if ( position.y > 1.0 || position.y < 0.0 ) {

						worldPos.xyz -= worldFwd * 2.0 * hw;

					}

				#endif

				// project the worldpos
				vec4 clip = projectionMatrix * worldPos;

				// shift the depth of the projected points so the line
				// segments overlap neatly
				vec3 clipPose = ( position.y < 0.5 ) ? ndcStart : ndcEnd;
				clip.z = clipPose.z * clip.w;

			#else

				vec2 offset = vec2( dir.y, - dir.x );
				// undo aspect ratio adjustment
				dir.x /= aspect;
				offset.x /= aspect;

				// sign flip
				if ( position.x < 0.0 ) offset *= - 1.0;

				// endcaps
				if ( position.y < 0.0 ) {

					offset += - dir;

				} else if ( position.y > 1.0 ) {

					offset += dir;

				}

				// adjust for linewidth
				offset *= linewidth;

				// adjust for clip-space to screen-space conversion // maybe resolution should be based on viewport ...
				offset /= resolution.y;

				// select end
				vec4 clip = ( position.y < 0.5 ) ? clipStart : clipEnd;

				// back to clip space
				offset *= clip.w;

				clip.xy += offset;

			#endif

			gl_Position = clip;

			vec4 mvPosition = ( position.y < 0.5 ) ? start : end; // this is an approximation

			#include <logdepthbuf_vertex>
			#include <clipping_planes_vertex>
			#include <fog_vertex>

		}
		`,fragmentShader:`
		uniform vec3 diffuse;
		uniform float opacity;
		uniform float linewidth;

		#ifdef USE_DASH

			uniform float dashOffset;
			uniform float dashSize;
			uniform float gapSize;

		#endif

		varying float vLineDistance;

		#ifdef WORLD_UNITS

			varying vec4 worldPos;
			varying vec3 worldStart;
			varying vec3 worldEnd;

			#ifdef USE_DASH

				varying vec2 vUv;

			#endif

		#else

			varying vec2 vUv;

		#endif

		#include <common>
		#include <color_pars_fragment>
		#include <fog_pars_fragment>
		#include <logdepthbuf_pars_fragment>
		#include <clipping_planes_pars_fragment>

		vec2 closestLineToLine(vec3 p1, vec3 p2, vec3 p3, vec3 p4) {

			float mua;
			float mub;

			vec3 p13 = p1 - p3;
			vec3 p43 = p4 - p3;

			vec3 p21 = p2 - p1;

			float d1343 = dot( p13, p43 );
			float d4321 = dot( p43, p21 );
			float d1321 = dot( p13, p21 );
			float d4343 = dot( p43, p43 );
			float d2121 = dot( p21, p21 );

			float denom = d2121 * d4343 - d4321 * d4321;

			float numer = d1343 * d4321 - d1321 * d4343;

			mua = numer / denom;
			mua = clamp( mua, 0.0, 1.0 );
			mub = ( d1343 + d4321 * ( mua ) ) / d4343;
			mub = clamp( mub, 0.0, 1.0 );

			return vec2( mua, mub );

		}

		void main() {

			#include <clipping_planes_fragment>

			#ifdef USE_DASH

				if ( vUv.y < - 1.0 || vUv.y > 1.0 ) discard; // discard endcaps

				if ( mod( vLineDistance + dashOffset, dashSize + gapSize ) > dashSize ) discard; // todo - FIX

			#endif

			float alpha = opacity;

			#ifdef WORLD_UNITS

				// Find the closest points on the view ray and the line segment
				vec3 rayEnd = normalize( worldPos.xyz ) * 1e5;
				vec3 lineDir = worldEnd - worldStart;
				vec2 params = closestLineToLine( worldStart, worldEnd, vec3( 0.0, 0.0, 0.0 ), rayEnd );

				vec3 p1 = worldStart + lineDir * params.x;
				vec3 p2 = rayEnd * params.y;
				vec3 delta = p1 - p2;
				float len = length( delta );
				float norm = len / linewidth;

				#ifndef USE_DASH

					#ifdef USE_ALPHA_TO_COVERAGE

						float dnorm = fwidth( norm );
						alpha = 1.0 - smoothstep( 0.5 - dnorm, 0.5 + dnorm, norm );

					#else

						if ( norm > 0.5 ) {

							discard;

						}

					#endif

				#endif

			#else

				#ifdef USE_ALPHA_TO_COVERAGE

					// artifacts appear on some hardware if a derivative is taken within a conditional
					float a = vUv.x;
					float b = ( vUv.y > 0.0 ) ? vUv.y - 1.0 : vUv.y + 1.0;
					float len2 = a * a + b * b;
					float dlen = fwidth( len2 );

					if ( abs( vUv.y ) > 1.0 ) {

						alpha = 1.0 - smoothstep( 1.0 - dlen, 1.0 + dlen, len2 );

					}

				#else

					if ( abs( vUv.y ) > 1.0 ) {

						float a = vUv.x;
						float b = ( vUv.y > 0.0 ) ? vUv.y - 1.0 : vUv.y + 1.0;
						float len2 = a * a + b * b;

						if ( len2 > 1.0 ) discard;

					}

				#endif

			#endif

			vec4 diffuseColor = vec4( diffuse, alpha );

			#include <logdepthbuf_fragment>
			#include <color_fragment>

			gl_FragColor = vec4( diffuseColor.rgb, alpha );

			#include <tonemapping_fragment>
			#include <colorspace_fragment>
			#include <fog_fragment>
			#include <premultiplied_alpha_fragment>

		}
		`};class oe extends ei{constructor(t){super({type:"LineMaterial",uniforms:je.clone(Dt.line.uniforms),vertexShader:Dt.line.vertexShader,fragmentShader:Dt.line.fragmentShader,clipping:!0}),this.isLineMaterial=!0,this.setValues(t)}get color(){return this.uniforms.diffuse.value}set color(t){this.uniforms.diffuse.value=t}get worldUnits(){return"WORLD_UNITS"in this.defines}set worldUnits(t){t===!0?this.defines.WORLD_UNITS="":delete this.defines.WORLD_UNITS}get linewidth(){return this.uniforms.linewidth.value}set linewidth(t){this.uniforms.linewidth&&(this.uniforms.linewidth.value=t)}get dashed(){return"USE_DASH"in this.defines}set dashed(t){t===!0!==this.dashed&&(this.needsUpdate=!0),t===!0?this.defines.USE_DASH="":delete this.defines.USE_DASH}get dashScale(){return this.uniforms.dashScale.value}set dashScale(t){this.uniforms.dashScale.value=t}get dashSize(){return this.uniforms.dashSize.value}set dashSize(t){this.uniforms.dashSize.value=t}get dashOffset(){return this.uniforms.dashOffset.value}set dashOffset(t){this.uniforms.dashOffset.value=t}get gapSize(){return this.uniforms.gapSize.value}set gapSize(t){this.uniforms.gapSize.value=t}get opacity(){return this.uniforms.opacity.value}set opacity(t){this.uniforms&&(this.uniforms.opacity.value=t)}get resolution(){return this.uniforms.resolution.value}set resolution(t){this.uniforms.resolution.value.copy(t)}get alphaToCoverage(){return"USE_ALPHA_TO_COVERAGE"in this.defines}set alphaToCoverage(t){this.defines&&(t===!0!==this.alphaToCoverage&&(this.needsUpdate=!0),t===!0?this.defines.USE_ALPHA_TO_COVERAGE="":delete this.defines.USE_ALPHA_TO_COVERAGE)}}const Ht=new yt,Ae=new E,Me=new E,j=new yt,k=new yt,Q=new yt,Ft=new E,Gt=new Ce,B=new oi,Te=new E,Tt=new te,Pt=new ke,J=new yt;let tt,ht;function Pe(s,t,e){return J.set(0,0,-t,1).applyMatrix4(s.projectionMatrix),J.multiplyScalar(1/J.w),J.x=ht/e.width,J.y=ht/e.height,J.applyMatrix4(s.projectionMatrixInverse),J.multiplyScalar(1/J.w),Math.abs(Math.max(J.x,J.y))}function Zi(s,t){const e=s.matrixWorld,i=s.geometry,o=i.attributes.instanceStart,n=i.attributes.instanceEnd,r=Math.min(i.instanceCount,o.count);for(let l=0,d=r;l<d;l++){B.start.fromBufferAttribute(o,l),B.end.fromBufferAttribute(n,l),B.applyMatrix4(e);const m=new E,a=new E;tt.distanceSqToSegment(B.start,B.end,a,m),a.distanceTo(m)<ht*.5&&t.push({point:a,pointOnLine:m,distance:tt.origin.distanceTo(a),object:s,face:null,faceIndex:l,uv:null,uv1:null})}}function Xi(s,t,e){const i=t.projectionMatrix,o=s.material.resolution,n=s.matrixWorld,r=s.geometry,l=r.attributes.instanceStart,d=r.attributes.instanceEnd,m=Math.min(r.instanceCount,l.count),a=-t.near;tt.at(1,Q),Q.w=1,Q.applyMatrix4(t.matrixWorldInverse),Q.applyMatrix4(i),Q.multiplyScalar(1/Q.w),Q.x*=o.x/2,Q.y*=o.y/2,Q.z=0,Ft.copy(Q),Gt.multiplyMatrices(t.matrixWorldInverse,n);for(let c=0,h=m;c<h;c++){if(j.fromBufferAttribute(l,c),k.fromBufferAttribute(d,c),j.w=1,k.w=1,j.applyMatrix4(Gt),k.applyMatrix4(Gt),j.z>a&&k.z>a)continue;if(j.z>a){const g=j.z-k.z,y=(j.z-a)/g;j.lerp(k,y)}else if(k.z>a){const g=k.z-j.z,y=(k.z-a)/g;k.lerp(j,y)}j.applyMatrix4(i),k.applyMatrix4(i),j.multiplyScalar(1/j.w),k.multiplyScalar(1/k.w),j.x*=o.x/2,j.y*=o.y/2,k.x*=o.x/2,k.y*=o.y/2,B.start.copy(j),B.start.z=0,B.end.copy(k),B.end.z=0;const u=B.closestPointToPointParameter(Ft,!0);B.at(u,Te);const f=ze.lerp(j.z,k.z,u),A=f>=-1&&f<=1,T=Ft.distanceTo(Te)<ht*.5;if(A&&T){B.start.fromBufferAttribute(l,c),B.end.fromBufferAttribute(d,c),B.start.applyMatrix4(n),B.end.applyMatrix4(n);const g=new E,y=new E;tt.distanceSqToSegment(B.start,B.end,y,g),e.push({point:y,pointOnLine:g,distance:tt.origin.distanceTo(y),object:s,face:null,faceIndex:c,uv:null,uv1:null})}}}class Vi extends et{constructor(t=new Fe,e=new oe({color:Math.random()*16777215})){super(t,e),this.isLineSegments2=!0,this.type="LineSegments2"}computeLineDistances(){const t=this.geometry,e=t.attributes.instanceStart,i=t.attributes.instanceEnd,o=new Float32Array(2*e.count);for(let r=0,l=0,d=e.count;r<d;r++,l+=2)Ae.fromBufferAttribute(e,r),Me.fromBufferAttribute(i,r),o[l]=l===0?0:o[l-1],o[l+1]=o[l]+Ae.distanceTo(Me);const n=new qt(o,2,1);return t.setAttribute("instanceDistanceStart",new pt(n,1,0)),t.setAttribute("instanceDistanceEnd",new pt(n,1,1)),this}raycast(t,e){const i=this.material.worldUnits,o=t.camera;o===null&&!i&&console.error('LineSegments2: "Raycaster.camera" needs to be set in order to raycast against LineSegments2 while worldUnits is set to false.');const n=t.params.Line2!==void 0&&t.params.Line2.threshold||0;tt=t.ray;const r=this.matrixWorld,l=this.geometry,d=this.material;ht=d.linewidth+n,l.boundingSphere===null&&l.computeBoundingSphere(),Pt.copy(l.boundingSphere).applyMatrix4(r);let m;if(i)m=ht*.5;else{const c=Math.max(o.near,Pt.distanceToPoint(tt.origin));m=Pe(o,c,d.resolution)}if(Pt.radius+=m,tt.intersectsSphere(Pt)===!1)return;l.boundingBox===null&&l.computeBoundingBox(),Tt.copy(l.boundingBox).applyMatrix4(r);let a;if(i)a=ht*.5;else{const c=Math.max(o.near,Tt.distanceToPoint(tt.origin));a=Pe(o,c,d.resolution)}Tt.expandByScalar(a),tt.intersectsBox(Tt)!==!1&&(i?Zi(this,e):Xi(this,o,e))}onBeforeRender(t){const e=this.material.uniforms;e&&e.resolution&&(t.getViewport(Ht),this.material.uniforms.resolution.value.set(Ht.z,Ht.w))}}class Ge extends Fe{constructor(){super(),this.isLineGeometry=!0,this.type="LineGeometry"}setPositions(t){const e=t.length-3,i=new Float32Array(2*e);for(let o=0;o<e;o+=3)i[2*o]=t[o],i[2*o+1]=t[o+1],i[2*o+2]=t[o+2],i[2*o+3]=t[o+3],i[2*o+4]=t[o+4],i[2*o+5]=t[o+5];return super.setPositions(i),this}setColors(t){const e=t.length-3,i=new Float32Array(2*e);for(let o=0;o<e;o+=3)i[2*o]=t[o],i[2*o+1]=t[o+1],i[2*o+2]=t[o+2],i[2*o+3]=t[o+3],i[2*o+4]=t[o+4],i[2*o+5]=t[o+5];return super.setColors(i),this}setFromPoints(t){const e=t.length-1,i=new Float32Array(6*e);for(let o=0;o<e;o++)i[6*o]=t[o].x,i[6*o+1]=t[o].y,i[6*o+2]=t[o].z||0,i[6*o+3]=t[o+1].x,i[6*o+4]=t[o+1].y,i[6*o+5]=t[o+1].z||0;return super.setPositions(i),this}fromLine(t){const e=t.geometry;return this.setPositions(e.attributes.position.array),this}}class Ki extends Vi{constructor(t=new Ge,e=new oe({color:Math.random()*16777215})){super(t,e),this.isLine2=!0,this.type="Line2"}}const $i=s=>{const t=new ut,e=[],i=[],{isSphere:o}=s;if(St.forEach((l,d)=>{const{enabled:m,line:a,scale:c,color:h}=s[l];if(!m||!a)return;const u=d<3?1:-1,f=(o?He-c/2:.975)*u;e.push(l.includes("x")?f:0,l.includes("y")?f:0,l.includes("z")?f:0,0,0,0);const A=t.set(h).toArray();i.push(...A,...A)}),!e.length)return null;const n=new Ge().setPositions(e).setColors(i),r=new oe({linewidth:s.lineWidth,vertexColors:!0,resolution:new F(window.innerWidth,window.innerHeight)});return new Ki(n,r).computeLineDistances()},Qi=s=>{const{corners:t,edges:e}=s,i=[],o=Ni(s),n=Fi(s,o);i.push(...n),t.enabled&&i.push(...Gi(s,o)),e.enabled&&i.push(...Wi(s,o,t.enabled?7:6));const r=qi(n,s),l=$i(s);return[i,r,l]},wt=(s,t=!0)=>{const{material:e,userData:i}=s,{opacity:o,color:n,scale:r}=t?i.hover:i;s.scale.setScalar(r),e.opacity=o,e.map?Hi(e.map,t):e.color.set(n)},ct=new Ce,De=new Wt,Ji=new F,lt=new E,Le=new yt;class ts extends Ot{constructor(t,e,i={}){super(),M(this,"enabled",!0),M(this,"camera"),M(this,"renderer"),M(this,"options"),M(this,"target",new E),M(this,"animated",!0),M(this,"speed",1),M(this,"animating",!1),M(this,"_options"),M(this,"_intersections"),M(this,"_background",null),M(this,"_viewport",[0,0,0,0]),M(this,"_originalViewport",[0,0,0,0]),M(this,"_originalScissor",[0,0,0,0]),M(this,"_scene"),M(this,"_camera"),M(this,"_container"),M(this,"_domElement"),M(this,"_domRect"),M(this,"_dragging",!1),M(this,"_distance",0),M(this,"_clock",new Ke),M(this,"_targetQuaternion",new vt),M(this,"_quaternionStart",new vt),M(this,"_quaternionEnd",new vt),M(this,"_pointerStart",new F),M(this,"_focus",null),M(this,"_placement"),M(this,"_controls"),M(this,"_controlsListeners"),this.camera=t,this.renderer=e,this._scene=new Re().add(this),this.set(i)}get placement(){return this._placement}set placement(t){this._placement=Ie(this._domElement,t),this.domUpdate()}set(t={}){this.dispose(),this.options=t,this._options=Ii(t),this._camera=this._options.isSphere?new $e(-1.8,1.8,1.8,-1.8,5,10):new Oe(26,1,5,10),this._camera.position.set(0,0,7);const[e,i,o]=Qi(this._options);i&&this.add(i),o&&this.add(o),this.add(...e),this._background=i,this._intersections=e;const{container:n,animated:r,speed:l}=this._options;return this.animated=r,this.speed=l,this._container=n?Ri(n):document.body,this._domElement=zi(this._options),this._domElement.onpointerdown=d=>this._onPointerDown(d),this._domElement.onpointermove=d=>this._onPointerMove(d),this._domElement.onpointerleave=()=>this._onPointerLeave(),this._container.appendChild(this._domElement),this._controls&&this.attachControls(this._controls),this.update(),this._updateOrientation(!0),this}render(){this.animating&&this._animate();const{renderer:t,_viewport:e}=this,i=t.getScissorTest(),o=t.autoClear;return t.autoClear=!1,t.setViewport(...e),i&&t.setScissor(...e),t.clear(!1,!0,!1),t.render(this._scene,this._camera),t.setViewport(...this._originalViewport),i&&t.setScissor(...this._originalScissor),t.autoClear=o,this}domUpdate(){this._domRect=this._domElement.getBoundingClientRect();const t=this.renderer,e=this._domRect,i=t.domElement.getBoundingClientRect();return this._viewport.splice(0,4,e.left-i.left,t.domElement.clientHeight-(e.top-i.top+e.height),e.width,e.height),t.getViewport(Le).toArray(this._originalViewport),t.getScissorTest()&&t.getScissor(Le).toArray(this._originalScissor),this}cameraUpdate(){return this._updateOrientation(),this}update(t=!0){return t&&this._controls&&this._controls.update(),this.domUpdate().cameraUpdate()}attachControls(t){return this.detachControls(),this.target=t.target,this._controlsListeners={start:()=>t.enabled=!1,end:()=>t.enabled=!0,change:()=>this.update(!1)},this.addEventListener("start",this._controlsListeners.start),this.addEventListener("end",this._controlsListeners.end),t.addEventListener("change",this._controlsListeners.change),this._controls=t,this}detachControls(){if(!(!this._controlsListeners||!this._controls))return this.target=new E().copy(this._controls.target),this.removeEventListener("start",this._controlsListeners.start),this.removeEventListener("end",this._controlsListeners.end),this._controls.removeEventListener("change",this._controlsListeners.change),this._controlsListeners=void 0,this._controls=void 0,this}dispose(){var t;this.detachControls(),this.children.forEach(e=>{var i,o,n,r;this.remove(e);const l=e;(i=l.material)==null||i.dispose(),(n=(o=l.material)==null?void 0:o.map)==null||n.dispose(),(r=l.geometry)==null||r.dispose()}),(t=this._domElement)==null||t.remove()}_updateOrientation(t=!0){t&&(this.quaternion.copy(this.camera.quaternion).invert(),this.updateMatrixWorld()),ge(this._options,this._intersections,this.camera)}_animate(){const{position:t,quaternion:e}=this.camera;if(t.set(0,0,1),!this.animated){t.applyQuaternion(this._quaternionEnd).multiplyScalar(this._distance).add(this.target),e.copy(this._targetQuaternion),this._updateOrientation(),this.animating=!1,this.dispatchEvent({type:"change"}),this.dispatchEvent({type:"end"});return}this._controls&&(this._controls.enabled=!1);const i=this._clock.getDelta()*Ui*this.speed;this._quaternionStart.rotateTowards(this._quaternionEnd,i),t.applyQuaternion(this._quaternionStart).multiplyScalar(this._distance).add(this.target),e.rotateTowards(this._targetQuaternion,i),this._updateOrientation(),requestAnimationFrame(()=>this.dispatchEvent({type:"change"})),this._quaternionStart.angleTo(this._quaternionEnd)<Nt&&(this._controls&&(this._controls.enabled=!0),this.animating=!1,this.dispatchEvent({type:"end"}))}_setOrientation(t){const e=this.camera,i=this.target;lt.copy(t).multiplyScalar(this._distance),ct.setPosition(lt).lookAt(lt,this.position,this.up),this._targetQuaternion.setFromRotationMatrix(ct),lt.add(i),ct.lookAt(lt,i,this.up),this._quaternionEnd.setFromRotationMatrix(ct),ct.setPosition(e.position).lookAt(e.position,i,this.up),this._quaternionStart.setFromRotationMatrix(ct),this.animating=!0,this._clock.start(),this.dispatchEvent({type:"start"})}_onPointerDown(t){if(!this.enabled)return;const e=d=>{if(!this._dragging){if(Ci(d,this._pointerStart))return;this._dragging=!0}const m=Ji.set(d.clientX,d.clientY).sub(this._pointerStart).multiplyScalar(1/this._domRect.width*Math.PI),a=this.coordinateConversion(lt.subVectors(this.camera.position,this.target)),c=De.setFromVector3(a);c.theta=r-m.x,c.phi=Zt(l-m.y,Nt,Math.PI-Nt),this.coordinateConversion(this.camera.position.setFromSpherical(c),!0).add(this.target),this.camera.lookAt(this.target),this.quaternion.copy(this.camera.quaternion).invert(),this._updateOrientation(!1),this.dispatchEvent({type:"change"})},i=()=>{if(document.removeEventListener("pointermove",e,!1),document.removeEventListener("pointerup",i,!1),!this._dragging)return this._handleClick(t);this._focus&&(wt(this._focus,!1),this._focus=null),this._dragging=!1,this.dispatchEvent({type:"end"})};if(this.animating)return;t.preventDefault(),this._pointerStart.set(t.clientX,t.clientY);const o=this.coordinateConversion(lt.subVectors(this.camera.position,this.target)),n=De.setFromVector3(o),r=n.theta,l=n.phi;this._distance=n.radius,document.addEventListener("pointermove",e,!1),document.addEventListener("pointerup",i,!1),this.dispatchEvent({type:"start"})}coordinateConversion(t,e=!1){const{x:i,y:o,z:n}=t,r=Ot.DEFAULT_UP;return r.x===1?e?t.set(o,n,i):t.set(n,i,o):r.z===1?e?t.set(n,i,o):t.set(o,n,i):t}_onPointerMove(t){!this.enabled||this._dragging||(this._background&&Se(this._background,!0),this._handleHover(t))}_onPointerLeave(){!this.enabled||this._dragging||(this._background&&Se(this._background,!1),this._focus&&wt(this._focus,!1),this._domElement.style.cursor="")}_handleClick(t){const e=ve(t,this._domRect,this._camera,this._intersections);this._focus&&(wt(this._focus,!1),this._focus=null),e&&(this._setOrientation(e.object.position),this.dispatchEvent({type:"change"}))}_handleHover(t){const e=ve(t,this._domRect,this._camera,this._intersections),i=e?.object||null;this._focus!==i&&(this._domElement.style.cursor=i?"pointer":"",this._focus&&wt(this._focus,!1),(this._focus=i)?wt(i,!0):ge(this._options,this._intersections,this.camera))}}const ot={ax:"RH",ay:"A",az:"RV"};function ss({C:s,accelPoints:t,height:e=150}){const i=st.useRef(null),o=st.useRef(null),n=st.useRef(null),r=st.useRef(null),l=st.useRef(null),d=st.useRef(null),[m,a]=st.useState(20);return st.useEffect(()=>{const c=i.current;if(!c)return;const h=new Re;h.background=new ut("#0b1e42");const u=new Oe(48,1,.1,100);u.position.set(6,4.8,6),u.lookAt(0,0,0);const f=new ni({antialias:!0,alpha:!1});f.setPixelRatio(Math.min(window.devicePixelRatio||1,2)),f.domElement.style.display="block",f.domElement.style.width="100%",f.domElement.style.height="100%",c.appendChild(f.domElement);const A=new ai(16777215,.7);h.add(A);const T=new ri(12046847,.95);T.position.set(5,8,4),h.add(T);const g=new de;h.add(g);const y=new et(new li(12,12),new ue({color:1456760,side:hi,transparent:!0,opacity:.42,roughness:.95,metalness:.05}));y.rotation.x=-Math.PI/2,y.position.y=-.01,g.add(y);const z=new ci(12,12,6726655,3104430);z.material.transparent=!0,z.material.opacity=.95,g.add(z);const w=new di(9.6),K=Array.isArray(w.material)?w.material:[w.material];for(const Y of K)Y.depthTest=!1,Y.depthWrite=!1,Y.transparent=!1,Y.toneMapped=!1;w.renderOrder=999,w.position.set(0,.03,0),g.add(w);const D=new de;D.renderOrder=1e3,D.position.set(0,.03,0),g.add(D);const _=3.4,x=.55,I=.24,v=new Bt(new E(1,0,0),new E(0,0,0),_,15680580,x,I),b=new Bt(new E(0,1,0),new E(0,0,0),_,2278750,x,I),X=new Bt(new E(0,0,1),new E(0,0,0),_,3900150,x,I),R=[v,b,X];for(const Y of R){const it=Y.line.material;it.depthTest=!1,it.depthWrite=!1,it.toneMapped=!1;const Et=Y.cone.material;Et.depthTest=!1,Et.depthWrite=!1,Et.toneMapped=!1,Y.renderOrder=1e3,D.add(Y)}const U=(Y,it)=>{const xt=document.createElement("canvas");xt.width=128,xt.height=128;const q=xt.getContext("2d");if(!q)return new Ot;q.clearRect(0,0,128,128),q.fillStyle="rgba(2,6,23,0.72)",q.beginPath(),q.arc(128/2,128/2,128*.26,0,Math.PI*2),q.fill(),q.lineWidth=4,q.strokeStyle=it,q.stroke(),q.fillStyle=it,q.font="700 64px Inter, Arial, sans-serif",q.textAlign="center",q.textBaseline="middle",q.fillText(Y,128/2,128/2+2);const le=new Ue(xt);le.needsUpdate=!0;const he=new Ut({map:le,transparent:!0,depthTest:!1,depthWrite:!1});he.toneMapped=!1;const kt=new Ct(he);return kt.scale.set(.58,.58,.58),kt.renderOrder=1001,kt},G=U(ot.ax,"#ef4444"),p=U(ot.ay,"#22c55e"),S=U(ot.az,"#3b82f6");G.position.set(_+.42,0,0),p.position.set(0,_+.42,0),S.position.set(0,0,_+.42),D.add(G),D.add(p),D.add(S);const N=new et(new Yt(.12,16,16),new ft({color:16777215}));N.position.set(0,.06,0),g.add(N);const L=new et(new pe(1.05,1.05,1.05),new ue({color:16096779,transparent:!0,opacity:.35,roughness:.45,metalness:.12}));L.position.set(0,0,0),g.add(L),l.current=L;const O=new ui(new pi(new pe(1.05,1.05,1.05)),new me({color:16498468}));O.position.set(0,0,0),g.add(O),d.current=O;const $=new Jt;$.setAttribute("position",new at([],3)),$.setAttribute("color",new at([],3));const V=new mi($,new me({vertexColors:!0,transparent:!0,opacity:.95}));g.add(V),n.current=V;const W=new et(new Yt(.14,20,20),new ft({color:16638023}));W.position.set(0,0,0),g.add(W),r.current=W;const H=new yi(u,f.domElement);H.enableDamping=!1,H.enablePan=!0,H.enableRotate=!0,H.minDistance=4,H.maxDistance=22,H.minPolarAngle=0,H.maxPolarAngle=Math.PI,H.mouseButtons.LEFT=nt.ROTATE,H.mouseButtons.MIDDLE=nt.DOLLY,H.mouseButtons.RIGHT=nt.PAN,H.screenSpacePanning=!0;const _t=new ts(u,f,{container:c.parentElement??c,type:"rounded-cube",size:72,placement:"bottom-right",offset:{right:10,bottom:8},animated:!0,speed:1.2,background:{color:16777215,opacity:1,hover:{color:16317180,opacity:1}},corners:{color:16777215,opacity:1},edges:{color:15857145,opacity:1},x:{color:15680580,label:ot.ax,labelColor:1120295},y:{color:2278750,label:ot.ay,labelColor:1120295},z:{color:3900150,label:ot.az,labelColor:1120295},nx:{color:16557477,label:`-${ot.ax}`,labelColor:1120295},ny:{color:8843180,label:`-${ot.ay}`,labelColor:1120295},nz:{color:9684477,label:`-${ot.az}`,labelColor:1120295}});_t.attachControls(H);const jt=()=>{H.target.set(0,0,0),u.position.set(6,4.8,6),u.lookAt(0,0,0),H.update()};o.current=jt,jt();const gt=()=>{const Y=c.clientWidth||1,it=c.clientHeight||1;u.aspect=Y/it,u.updateProjectionMatrix(),f.setSize(Y,it),jt(),_t.update()};gt();const We=window.requestAnimationFrame(()=>gt()),Ye=window.setTimeout(()=>gt(),80),qe=window.setTimeout(()=>gt(),240),ne=new ResizeObserver(gt);ne.observe(c);let ae=0;const re=()=>{ae=window.requestAnimationFrame(re),H.update(),f.render(h,u),_t.render()};return re(),()=>{window.cancelAnimationFrame(ae),window.cancelAnimationFrame(We),window.clearTimeout(Ye),window.clearTimeout(qe),ne.disconnect(),_t.detachControls(),_t.dispose(),H.dispose(),h.clear(),f.dispose(),f.domElement.parentElement===c&&c.removeChild(f.domElement),o.current=null,n.current=null,r.current=null,l.current=null,d.current=null}},[]),st.useEffect(()=>{const c=n.current,h=r.current,u=l.current,f=d.current;if(!c||!h||!u||!f)return;const A=t.filter(p=>Number.isFinite(p.ts)&&Number.isFinite(p.ax)&&Number.isFinite(p.ay)&&Number.isFinite(p.az)).sort((p,S)=>p.ts-S.ts);if(A.length===0){const p=c.geometry;p.setAttribute("position",new at([],3)),p.setAttribute("color",new at([],3)),p.computeBoundingSphere(),h.visible=!1,u.position.set(0,0,0),f.position.set(0,0,0);return}const g=A[A.length-1].ts-m*1e3;let y=A.filter(p=>p.ts>=g);y.length<2&&(y=A.slice(-Math.min(20,A.length)));const z=140;if(y.length>z){const p=[];for(let S=0;S<z;S+=1){const N=Math.round(S/(z-1)*(y.length-1));p.push(y[N])}y=p}if(y.length===0){const p=c.geometry;p.setAttribute("position",new at([],3)),p.setAttribute("color",new at([],3)),p.computeBoundingSphere(),h.visible=!1,u.position.set(0,0,0),f.position.set(0,0,0);return}const w=y.map((p,S)=>{const N=y[Math.max(0,S-1)],L=y[Math.min(y.length-1,S+1)];return{...p,ax:(N.ax+p.ax+L.ax)/3,ay:(N.ay+p.ay+L.ay)/3,az:(N.az+p.az+L.az)/3}}),K=w.reduce((p,S)=>p+S.ax,0)/w.length,D=w.reduce((p,S)=>p+S.ay,0)/w.length,_=w.reduce((p,S)=>p+S.az,0)/w.length;let x=0;for(const p of w)x=Math.max(x,Math.abs(p.ax-K),Math.abs(p.ay-D),Math.abs(p.az-_));const I=x>0?2.8/x:1,v=new Float32Array(y.length*3),b=new Float32Array(y.length*3),X=p=>({x:(p.ax-K)*I,y:(p.az-_)*I,z:(p.ay-D)*I});w.forEach((p,S)=>{const N=X(p),L=S*3;v[L]=N.x,v[L+1]=N.y,v[L+2]=N.z;const O=w.length<=1?1:S/(w.length-1),$=new ut("#22d3ee"),V=new ut("#facc15"),W=$.lerp(V,O);b[L]=W.r,b[L+1]=W.g,b[L+2]=W.b});const R=[];for(let p=1;p<w.length;p+=1){const S=w[p].ts-w[p-1].ts;Number.isFinite(S)&&S>0&&R.push(S)}if(R.length>0){const p=[...R].sort((O,$)=>O-$),S=p[Math.floor(p.length/2)],N=Math.max(2e3,S*2.5),L=new ut("#fb7185");for(let O=1;O<w.length;O+=1)if(w[O].ts-w[O-1].ts>N){const V=O*3,W=(O-1)*3;b[V]=L.r,b[V+1]=L.g,b[V+2]=L.b,b[W]=L.r,b[W+1]=L.g,b[W+2]=L.b}}const U=c.geometry;U.setAttribute("position",new mt(v,3)),U.setAttribute("color",new mt(b,3)),U.computeBoundingSphere();const G=X(w[w.length-1]);h.visible=!0,h.position.set(G.x,G.y,G.z),u.position.copy(h.position),f.position.copy(h.position)},[t,m]),bt.jsxs("div",{style:{position:"relative",width:"100%",height:e,borderRadius:10,border:`1px solid ${s.cardBorder}`,overflow:"hidden"},children:[bt.jsx("div",{ref:i,style:{width:"100%",height:"100%"}}),bt.jsx("button",{type:"button",onClick:()=>o.current?.(),style:{position:"absolute",right:10,top:8,borderRadius:6,border:`1px solid ${s.border}`,background:"rgba(2, 6, 23, 0.42)",color:s.textMuted,fontSize:"0.62rem",fontWeight:600,padding:"2px 8px",cursor:"pointer"},children:"Reset View"}),bt.jsx("div",{style:{position:"absolute",left:8,top:8,display:"flex",gap:6,alignItems:"center"},children:[10,20,40].map(c=>{const h=c===m;return bt.jsxs("button",{type:"button",onClick:()=>a(c),style:{borderRadius:999,border:`1px solid ${h?s.primary:s.border}`,background:h?"rgba(59,130,246,0.18)":"rgba(2, 6, 23, 0.42)",color:h?s.textBright:s.textMuted,fontSize:"0.62rem",fontWeight:700,padding:"2px 8px",cursor:"pointer"},children:[c,"s"]},c)})})]})}export{ss as Accel3DCanvas};
