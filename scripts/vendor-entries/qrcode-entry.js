/* 打成单文件 IIFE，供 app.js 通过 window.__qrcodeToDataURL 调用 */
import { toDataURL } from "qrcode";
window.__qrcodeToDataURL = toDataURL;
