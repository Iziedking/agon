"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { LoginModal } from "@/components/pengu/LoginModal";
import { TagButton, type TagButtonProps } from "@/components/redesign/TagButton";
import { useAuth } from "@/hooks/useAuth";
import { useAgonNetwork } from "@/hooks/useAgonNetwork";
import { networkHref } from "@/lib/agon/network";

type Props = {
  href: string;
  children: ReactNode;
  variant?: "primary" | "ghost";
  size?: "md" | "sm";
  arrow?: boolean;
  className?: string;
  style?: CSSProperties;
};

/**
 * A public-first action: signed-out visitors get the login modal, while an
 * authenticated operator follows the requested route. Successful sign-in is
 * sent through the existing onboarding check so new and returning operators
 * do not land in the wrong part of the product.
 */
export function AgonAuthAction({ href, children, ...button }: Props) {
  const router = useRouter();
  const { me } = useAuth();
  const { networkKey } = useAgonNetwork();
  const [open, setOpen] = useState(false);
  const waitingForAuth = useRef(false);

  useEffect(() => {
    if (!open || !waitingForAuth.current || !me) return;
    waitingForAuth.current = false;
    setOpen(false);

    router.replace(networkHref(href, networkKey));
  }, [href, me, networkKey, open, router]);

  function handleClick() {
    if (me) {
      router.push(networkHref(href, networkKey));
      return;
    }
    waitingForAuth.current = true;
    setOpen(true);
  }

  return (
    <>
      <TagButton {...button} onClick={handleClick}>{children}</TagButton>
      <LoginModal open={open} onClose={() => { waitingForAuth.current = false; setOpen(false); }} />
    </>
  );
}

// Keep the import type available to consumers that previously treated this
// wrapper like a TagButton without making the public API depend on the union.
export type AgonAuthActionButtonProps = Omit<TagButtonProps, "href" | "onClick" | "children"> & Props;
