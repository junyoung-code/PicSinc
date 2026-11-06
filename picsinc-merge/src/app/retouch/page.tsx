import type { Metadata } from "next";
import RetouchEditor from "@/features/face-retouch/ui/RetouchEditor";
export const metadata:Metadata={title:"MOIRA · 함께 보정",robots:{index:false,follow:false}};
export default function RetouchPage(){return <RetouchEditor/>;}
