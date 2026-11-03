import type { Metadata } from "next";
import RetouchEditor from "@/features/face-retouch/ui/RetouchEditor";
export const metadata:Metadata={title:"PicSync 얼굴 보정 · 로컬 검증",robots:{index:false,follow:false}};
export default function RetouchPage(){return <RetouchEditor/>;}
