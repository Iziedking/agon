const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8082";

export type SupportMessage = {
  messageId: string;
  authorType: "user" | "assistant" | "staff" | "system";
  authorName: string;
  body: string;
  visibility: "public" | "internal";
  createdAt: string;
};

export type SupportTicket = {
  ticket_id?: string;
  ticketId?: string;
  reference: string;
  requester_name?: string;
  requester_email?: string;
  subject: string;
  status: string;
  priority: string;
  assigned_staff_id?: string | null;
  assigned_name?: string | null;
  last_message_at?: string;
  updated_at?: string;
};

export type SupportStaff = {
  staffId: string;
  email: string;
  displayName: string;
  role: "support" | "technical";
  mustChangePassword: boolean;
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${AUTH_URL}${path}`, { credentials: "include", cache: "no-store", ...init });
  const payload = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(payload.error ?? "Support request failed");
  return payload;
}

export function createSupportTicket(input: { requesterName: string; requesterEmail: string; subject: string; message: string }) {
  return request<{ ticketId: string; reference: string; accessToken: string }>("/support/tickets", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
  });
}

export function readSupportTicket(ticketId: string, accessToken: string) {
  return request<{ ticket: SupportTicket; messages: SupportMessage[] }>(`/support/tickets/${encodeURIComponent(ticketId)}`, {
    headers: { "x-support-ticket-token": accessToken },
  });
}

export function sendSupportMessage(ticketId: string, accessToken: string, message: string) {
  return request<{ ok: true }>(`/support/tickets/${encodeURIComponent(ticketId)}/messages`, {
    method: "POST", headers: { "content-type": "application/json", "x-support-ticket-token": accessToken }, body: JSON.stringify({ message }),
  });
}

export function staffLogin(email: string, password: string) {
  return request<{ staff: SupportStaff }>("/support/staff/login", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }),
  });
}
export function staffSession() { return request<{ staff: SupportStaff }>("/support/staff/session"); }
export function staffLogout() { return request<{ ok: true }>("/support/staff/logout", { method: "POST" }); }
export function changeStaffPassword(currentPassword: string, newPassword: string) {
  return request<{ ok: true }>("/support/staff/password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ currentPassword, newPassword }) });
}
export function listStaffTickets(status?: string) {
  const query = status && status !== "all" ? `?status=${encodeURIComponent(status)}` : "";
  return request<{ tickets: SupportTicket[] }>(`/support/staff/tickets${query}`);
}
export function readStaffTicket(ticketId: string) { return request<{ ticket: SupportTicket; messages: SupportMessage[] }>(`/support/staff/tickets/${encodeURIComponent(ticketId)}`); }
export function assignStaffTicket(ticketId: string) { return request<{ ok: true }>(`/support/staff/tickets/${encodeURIComponent(ticketId)}/assign`, { method: "POST" }); }
export function updateStaffTicket(ticketId: string, status: string, priority?: string) {
  return request<{ ok: true }>(`/support/staff/tickets/${encodeURIComponent(ticketId)}/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status, priority }) });
}
export function replyToStaffTicket(ticketId: string, message: string, internal: boolean) {
  return request<{ ok: true }>(`/support/staff/tickets/${encodeURIComponent(ticketId)}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, internal }) });
}

export type StaffAccountRecord = {
  staff_id: string; email: string; display_name: string; role: string; status: string; must_change_password: boolean; last_login_at: string | null;
};
export function listStaffAccounts(adminToken: string) {
  return request<{ staff: StaffAccountRecord[] }>("/admin/support/staff", { headers: { "x-admin-token": adminToken } });
}
export function createStaffAccount(adminToken: string, input: { email: string; displayName: string; password: string; role: string }) {
  return request<{ staffId: string }>("/admin/support/staff", { method: "POST", headers: { "content-type": "application/json", "x-admin-token": adminToken }, body: JSON.stringify(input) });
}
export function disableStaffAccount(adminToken: string, staffId: string) {
  return request<{ ok: true }>(`/admin/support/staff/${encodeURIComponent(staffId)}/disable`, { method: "POST", headers: { "x-admin-token": adminToken } });
}
