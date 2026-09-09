"use client";
import { useState } from "react";
import { ReportConfiguration } from "@/shared/ReportConfiguration";
export function ConfigurationPreview() {
  const [message,setMessage]=useState("");
  return <main className="mx-auto max-w-3xl p-5 text-ink"><p className="border border-accent p-4 text-sm">Local UI preview. Fixture data only. No wallet, network task, or payment can be started here.</p><h1 className="mt-6 font-stencil text-3xl uppercase">Report configuration preview</h1><ReportConfiguration version="preview-version-not-a-live-service" readiness={{chainId:97,agentId:"preview",status:"available",enabled:true,blockers:[],providerAddress:null,token:{symbol:"TEST",decimals:18,address:`0x${"0".repeat(40)}`},priceRaw:"100000000000000000",priceDisplay:"0.1",checkedAt:"2026-09-08T00:00:00Z"}} busy={false} signedIn={false} signIn={()=>setMessage("Preview boundary reached. No sign-in or wallet action was requested.")} submit={()=>setMessage("Preview only. No request sent.")}/>{message?<p role="status" className="mt-5 text-sm">{message}</p>:null}</main>;
}
