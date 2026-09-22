import type { Metadata } from "next";
import { SupportAdminWorkspace } from "@/components/support/SupportAdminWorkspace";
export const metadata: Metadata = { title: "Support team" };
export default function SupportAdminPage() { return <SupportAdminWorkspace />; }
