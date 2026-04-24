import{c as R,u as M,r as p,j as e,M as A,n as T,R as H,W as P,o as V,i as _,A as K,P as X,T as q}from"./index-BVOjegk2.js";import{C as Q,M as O,a as S,b as G}from"./Modal-CZck2tzH.js";import{F as B,a as J,b as ee,S as te}from"./Form-Cl1_YOiD.js";import{L}from"./loader-circle-7QvZStOD.js";const ie=[["path",{d:"M16 14v2.2l1.6 1",key:"fo4ql5"}],["path",{d:"M16 2v4",key:"4m81vk"}],["path",{d:"M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5",key:"1osxxc"}],["path",{d:"M3 10h5",key:"r794hk"}],["path",{d:"M8 2v4",key:"1cmpym"}],["circle",{cx:"16",cy:"16",r:"6",key:"qoo3c4"}]],F=R("calendar-clock",ie);const ae=[["rect",{width:"20",height:"8",x:"2",y:"2",rx:"2",ry:"2",key:"ngkwjq"}],["rect",{width:"20",height:"8",x:"2",y:"14",rx:"2",ry:"2",key:"iecqi9"}],["line",{x1:"6",x2:"6.01",y1:"6",y2:"6",key:"16zg32"}],["line",{x1:"6",x2:"6.01",y1:"18",y2:"18",key:"nzw8ys"}]],ne=R("server",ae);function v(t){return t==null?"":String(t)}function y(t){return!t||typeof t!="object"||Array.isArray(t)?{}:t}function Z(t){if(typeof t=="number"&&Number.isFinite(t))return t;if(typeof t=="string"&&t.trim()){const n=Number(t);if(Number.isFinite(n))return n}return 0}function se(t){const n=y(t);return(Array.isArray(n.data)?n.data:Array.isArray(t)?t:[]).map(s=>y(s)).map(s=>({id:Z(s.id),code:v(s.code).trim(),name:v(s.name).trim()})).filter(s=>s.id>0&&s.code).sort((s,h)=>s.code.localeCompare(h.code,"vi"))}function re({icon:t,label:n,value:r}){const{C:s}=M();return e.jsxs("div",{className:"device-info-detail-row",style:{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,padding:"10px 6px"},children:[e.jsxs("div",{className:"device-info-detail-label-wrap",style:{display:"flex",alignItems:"center",gap:9,color:s.textMuted,minWidth:0,flex:1},children:[e.jsx("span",{className:"device-info-detail-icon",style:{display:"inline-flex",flexShrink:0},children:t}),e.jsx("span",{className:"device-info-detail-label",style:{fontSize:"0.74rem"},children:n})]}),e.jsx("span",{className:"device-info-detail-value",style:{fontSize:"0.74rem",color:s.textBright,textAlign:"right",maxWidth:"58%",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",fontWeight:600},children:r||"--"})]})}function oe({open:t,onClose:n,sensor:r,onSaved:s,onNotify:h}){const{C:o}=M(),[a,E]=p.useState([]),[g,C]=p.useState(!1),[l,d]=p.useState(!1),[b,z]=p.useState(r.name||""),[k,I]=p.useState(r.zoneCode||""),[x,m]=p.useState("");p.useEffect(()=>{if(!t){d(!1);return}z(r.name||""),I(r.zoneCode||""),m("")},[t,r.id]),p.useEffect(()=>{!t||a.length>0||$()},[t,a.length]);async function $(){C(!0),m("");try{const i=await fetch("/api/zones",{method:"GET",headers:{Accept:"application/json"}}),c=await i.json().catch(()=>({}));if(!i.ok)throw new Error(v(y(c).error||"zone_load_failed"));E(se(c))}catch(i){m(`Không tải được danh sách khu vực: ${v(i)}`)}finally{C(!1)}}async function D(){const i=b.trim(),c=k.trim(),u=Date.now(),j=450,N=async()=>{const f=Date.now()-u;f<j&&await new Promise(w=>setTimeout(w,j-f))};d(!0),m("");try{const f=await fetch(`/api/devices/${encodeURIComponent(r.id)}`,{method:"PUT",headers:{Accept:"application/json","Content-Type":"application/json"},body:JSON.stringify({name:i,zone:c})}),w=await f.json().catch(()=>({}));if(!f.ok)throw new Error(v(y(w).error||"device_update_failed"));await N();const U=a.find(Y=>Y.code===c),W={...r,name:i||r.id,zoneCode:c,zone:c?U?.code||c:"--"};s(W),h?.({type:"success",title:"Lưu thành công",text:`Đã cập nhật thông tin thiết bị ${W.name}.`}),d(!1),n()}catch(f){await N();const w=`Không lưu được: ${v(f)}`;m(w),h?.({type:"warning",title:"Lưu thất bại",text:w}),d(!1)}}return t?e.jsx(O,{open:!0,onClose:n,title:"Chỉnh sửa thiết bị",description:`Cập nhật tên và khu vực cho ${r.name||r.id}`,width:520,zIndex:120,disableClose:l,backdropBlur:0,cardClassName:"device-info-edit-modal",footer:e.jsxs("div",{style:{display:"inline-flex",alignItems:"center",gap:8},children:[e.jsx(S,{variant:"neutral",size:"sm",className:"device-info-action-btn",onClick:n,disabled:l,children:"Huỷ"}),e.jsxs(S,{variant:"primary",size:"sm",className:"device-info-action-btn",onClick:()=>{D()},disabled:l||g,children:[l?e.jsx(L,{size:13,className:"animate-spin"}):e.jsx(te,{size:13}),l?"Đang lưu...":"Lưu thay đổi"]})]}),children:e.jsxs("div",{style:{display:"grid",gap:12},children:[e.jsxs("div",{style:{display:"grid",gap:6},children:[e.jsx("div",{style:{color:o.textMuted,fontSize:"0.7rem",fontWeight:700},children:"Tên thiết bị"}),e.jsx(B,{className:"h-9",children:e.jsx(J,{value:b,onChange:i=>z(i.target.value),disabled:l,placeholder:"Nhập tên thiết bị"})})]}),e.jsxs("div",{style:{display:"grid",gap:6},children:[e.jsx("div",{style:{color:o.textMuted,fontSize:"0.7rem",fontWeight:700},children:"Khu vực"}),g?e.jsxs("div",{style:{height:36,borderRadius:9,border:`1px solid ${o.cardBorder}`,background:o.input,color:o.textMuted,display:"inline-flex",alignItems:"center",gap:7,padding:"0 11px",fontSize:"0.72rem"},children:[e.jsx(L,{size:13,className:"animate-spin"}),"Đang tải..."]}):e.jsx(B,{className:"h-9",children:e.jsxs(ee,{value:k,onChange:i=>I(i.target.value),disabled:l,style:{cursor:l?"wait":"pointer"},children:[e.jsx("option",{value:"",children:"Không chọn khu vực"}),a.map(i=>e.jsxs("option",{value:i.code,children:[i.code," - ",i.name]},i.id))]})})]}),x?e.jsxs("div",{role:"alert",style:{display:"inline-flex",alignItems:"flex-start",gap:7,color:o.danger,background:o.dangerBg,border:`1px solid ${o.danger}40`,borderRadius:8,padding:"8px 9px",fontSize:"0.72rem",lineHeight:1.45},children:[e.jsx(_,{size:14,strokeWidth:2.2}),e.jsx("span",{children:x})]}):null]})}):null}function me({sensor:t,onClose:n,onSensorUpdated:r,onSensorDeleted:s,onNotify:h,initialMode:o="view"}){const{C:a}=M(),[E,g]=p.useState(!1),[C,l]=p.useState(!1),[d,b]=p.useState(!1),z=o==="edit",k=o==="delete",I=!z&&!k;if(p.useEffect(()=>{if(!t){g(!1),l(!1),b(!1);return}g(o==="edit"),l(o==="delete")},[t?.id,o]),!t)return null;const x=t.online,m=t.status==="abnormal",$=[{title:"Thông tin chung",items:[{icon:e.jsx(ne,{size:14}),label:"UUID",value:t.uuid},{icon:e.jsx(A,{size:14}),label:"Site",value:t.site},{icon:e.jsx(A,{size:14}),label:"Zone",value:t.zone}]},{title:"Phần cứng",items:[{icon:e.jsx(T,{size:14}),label:"Sensor Version",value:t.sensorVersion},{icon:e.jsx(T,{size:14}),label:"Firmware Version",value:t.firmwareVersion},{icon:e.jsx(H,{size:14}),label:"Signal",value:t.signal}]},{title:"Thời gian",items:[{icon:e.jsx(Q,{size:14}),label:"Uptime",value:t.uptime},{icon:e.jsx(F,{size:14}),label:"Connected At",value:t.connectedAt},{icon:e.jsx(F,{size:14}),label:"Last Heartbeat",value:t.lastHeartbeatAt}]}];async function D(){if(!d){b(!0);try{const i=await fetch(`/api/devices/${encodeURIComponent(t.id)}`,{method:"DELETE",headers:{Accept:"application/json"}}),c=await i.json().catch(()=>({}));if(!i.ok)throw new Error(v(y(c).error||"device_delete_failed"));const u=y(c),j=y(u.data),N=Z(j.telemetryDeleted),f=new Intl.NumberFormat("vi-VN").format(N);h?.({type:"success",title:"Xoá thiết bị thành công",text:`Đã xoá: ${f} dữ liệu telemetry của thiết bị ${t.name||t.id}.`}),l(!1),s?.(t.id),n()}catch(i){h?.({type:"warning",title:"Xoá thiết bị thất bại",text:`Không xoá được thiết bị: ${v(i)}`})}finally{b(!1)}}}return e.jsxs(e.Fragment,{children:[e.jsx("style",{children:`
        @keyframes deviceInfoBackdropIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes deviceInfoModalIn {
          from {
            opacity: 0;
            transform: translate(-50%, -48.5%) scale(0.975);
          }
          to {
            opacity: 1;
            transform: translate(-50%, -50%) scale(1);
          }
        }

        @keyframes deviceInfoEnter {
          from {
            opacity: 0;
            transform: translateY(4px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .zone-modal-backdrop {
          animation: deviceInfoBackdropIn 150ms ease;
        }

        .zone-modal-card {
          animation: deviceInfoModalIn 170ms cubic-bezier(0.24, 0.82, 0.22, 1);
          will-change: transform, opacity;
        }

        .device-info-main-modal {
          width: min(540px, calc(100vw - 24px)) !important;
        }

        .device-info-shell {
          animation: deviceInfoEnter 160ms ease;
        }

        .device-info-pill {
          transition: transform 120ms ease, filter 120ms ease;
        }

        .device-info-pill:hover {
          transform: translateY(-1px);
          filter: brightness(1.03);
        }

        .device-info-cta {
          transition: transform 140ms ease, box-shadow 140ms ease, filter 140ms ease;
        }

        .device-info-cta:hover {
          transform: translateY(-1px);
          filter: brightness(1.04);
          box-shadow: 0 8px 18px rgba(37, 99, 235, 0.18);
        }

        .device-info-cta:active {
          transform: translateY(0) scale(0.985);
        }

        .device-info-section {
          transition: border-color 140ms ease;
        }

        .device-info-section:hover {
          border-color: ${a.primary}44 !important;
        }

        .device-info-action-btn {
          transition: transform 140ms ease, box-shadow 140ms ease, filter 140ms ease !important;
        }

        .device-info-action-btn:hover {
          transform: translateY(-1px);
          filter: brightness(1.03);
          box-shadow: 0 6px 16px rgba(2, 6, 23, 0.14);
        }

        .device-info-action-btn:active {
          transform: translateY(0) scale(0.985);
          box-shadow: none;
        }

        @media (max-width: 1512px) {
          .device-info-main-modal {
            width: min(520px, calc(100vw - 20px)) !important;
          }

          .device-info-detail-value {
            max-width: 61% !important;
          }
        }

        @media (max-width: 1366px) {
          .device-info-main-modal {
            width: min(485px, calc(100vw - 16px)) !important;
          }

          .device-info-shell {
            gap: 11px !important;
          }

          .device-info-detail-row {
            align-items: flex-start !important;
            gap: 8px !important;
            padding: 9px 4px !important;
          }

          .device-info-detail-label,
          .device-info-detail-value {
            font-size: 0.71rem !important;
            line-height: 1.4;
          }

          .device-info-detail-value {
            max-width: 66% !important;
            white-space: normal !important;
            overflow: visible !important;
            text-overflow: clip !important;
            overflow-wrap: anywhere;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .zone-modal-backdrop,
          .zone-modal-card,
          .device-info-shell {
            animation: none !important;
          }

          .device-info-pill,
          .device-info-cta,
          .device-info-section,
          .device-info-action-btn {
            transition: none !important;
            transform: none !important;
          }
        }
      `}),I?e.jsx(O,{open:!0,onClose:n,disableClose:d,title:t.name||t.id,description:`${t.id} • ${t.zone||"--"}`,width:540,backdropBlur:0,cardClassName:"device-info-main-modal",footer:e.jsxs("div",{style:{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap"},children:[e.jsxs("span",{style:{color:a.textMuted,fontSize:"0.68rem",fontWeight:600},children:["Cập nhật ",t.lastUpdated," phút trước"]}),e.jsx(S,{variant:"neutral",size:"sm",className:"device-info-action-btn",onClick:n,disabled:d,children:"Đóng"})]}),children:e.jsxs("div",{className:"device-info-shell",style:{display:"grid",gap:14},children:[e.jsxs("div",{style:{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap"},children:[e.jsxs("div",{style:{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"},children:[e.jsxs("div",{className:"device-info-pill",style:{height:28,padding:"0 10px",borderRadius:999,border:`1px solid ${x?`${a.success}45`:a.border}`,background:x?a.successBg:a.input,color:x?a.success:a.textMuted,fontSize:"0.67rem",fontWeight:700,display:"inline-flex",alignItems:"center",gap:5},children:[x?e.jsx(P,{size:12,strokeWidth:2.1}):e.jsx(V,{size:12,strokeWidth:2.1}),x?"Trực tuyến":"Ngoại tuyến"]}),e.jsxs("div",{className:"device-info-pill",style:{height:28,padding:"0 10px",borderRadius:999,border:`1px solid ${m?`${a.danger}45`:`${a.primary}45`}`,background:m?a.dangerBg:a.primaryBg,color:m?a.danger:a.primary,fontSize:"0.67rem",fontWeight:700,display:"inline-flex",alignItems:"center",gap:5},children:[m?e.jsx(_,{size:12,strokeWidth:2.1}):e.jsx(K,{size:12,strokeWidth:2.1}),m?"Bất thường":"Bình thường"]})]}),e.jsxs("div",{style:{display:"inline-flex",alignItems:"center",gap:6,marginLeft:"auto"},children:[e.jsxs(S,{variant:"primary",size:"sm",className:"device-info-cta",disabled:d,onClick:()=>g(!0),children:[e.jsx(X,{size:13}),"Chỉnh sửa"]}),e.jsxs(S,{variant:"danger",size:"sm",className:"device-info-cta",disabled:d,onClick:()=>l(!0),children:[e.jsx(q,{size:13}),"Xoá thiết bị"]})]})]}),e.jsx("div",{style:{display:"grid",gap:12},children:$.map((i,c)=>e.jsxs("div",{className:"device-info-section",style:{animation:"deviceInfoEnter 150ms ease both"},children:[c>0?e.jsx("div",{style:{borderTop:`1px solid ${a.border}`,marginBottom:10}}):null,e.jsx("div",{style:{color:a.textMuted,fontSize:"0.63rem",letterSpacing:"0.08em",textTransform:"uppercase",fontWeight:700,marginBottom:6,padding:"0 6px"},children:i.title}),e.jsx("div",{style:{border:`1px solid ${a.border}`,borderRadius:10,background:a.card,padding:"0 6px"},children:i.items.map((u,j)=>e.jsx("div",{style:j>0?{borderTop:`1px solid ${a.border}`}:void 0,children:e.jsx(re,{icon:u.icon,label:u.label,value:u.value})},u.label))})]},i.title))})]})}):null,e.jsx(oe,{open:E,onClose:()=>{g(!1),z&&n()},sensor:t,onSaved:i=>r?.(i),onNotify:h}),e.jsx(G,{open:C,onClose:()=>{d||(l(!1),k&&n())},onConfirm:()=>{D()},title:"Xác nhận xoá thiết bị",description:e.jsxs(e.Fragment,{children:["Thiết bị ",e.jsx("strong",{style:{color:a.textBright},children:t.name||t.id})," sẽ bị lưu trữ và không còn hiển thị ở danh sách vận hành."]}),confirmLabel:d?"Đang xoá...":"Xoá thiết bị",cancelLabel:"Huỷ",busy:d,danger:!0,zIndex:123})]})}export{me as DeviceInfoModal};
