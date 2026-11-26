"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"
import { useModalBack } from "@/lib/use-modal-back"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

function Dialog({ open, defaultOpen, onOpenChange, ...props }) {
  // Phone ka Back pehle ise band kare, page ko nahi — poora kyun aur kaise
  // lib/use-modal-back.js me likha hai. Yahan baithne se har dialog ko ye apne aap
  // milta hai, har call site par yaad rakhne ki zaroorat nahi.
  //
  // Khulna-band hona yahan se chalaya jaata hai (chahe call site ne `open` diya ho ya
  // nahi), kyunki Back dabne par hume KHUD band karna padta hai — aur bina state haath
  // me liye uncontrolled wale modal ka hamein pata hi nahi chalta ki wo khula hai.
  const [selfOpen, setSelfOpen] = React.useState(!!defaultOpen);
  const controlled = open !== undefined;
  const isOpen = controlled ? open : selfOpen;
  const change = React.useCallback(
    (next, ...rest) => {
      if (!controlled) setSelfOpen(next);
      onOpenChange?.(next, ...rest);
    },
    [controlled, onOpenChange],
  );
  useModalBack(isOpen, React.useCallback(() => change(false), [change]));
  return <DialogPrimitive.Root data-slot="dialog" open={isOpen} onOpenChange={change} {...props} />;
}

function DialogTrigger({
  ...props
}) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({
  ...props
}) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({
  ...props
}) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        // Phone par backdrop-blur NAHI: page ke glass cards (backdrop-filter) ke upar ek
        // aur backdrop-filter wala fixed overlay Android Chrome me compositing tod deta
        // hai — cards sheet ke background ke UPAR aur uske text ke NEECHE paint hote hain
        // ("UI fat jaata hai"). Emulator me nahi dikhta, asli phone par dikhta hai. Isliye
        // phone par sirf gehra dim, blur sm+ (desktop) par hi.
        "fixed inset-0 isolate z-50 bg-black/40 duration-100 sm:bg-black/10 sm:supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props} />
  );
}

function DialogContent({
  className,
  // Backdrop yahin andar banta hai, isliye jis caller ko use badalna ho uske paas koi
  // raasta nahi tha. "What's new" wale modal ko baaki popups ke UPAR aana hai (z-60), aur
  // sirf uska popup upar karne se uske NEECHE doosre dialog ka backdrop reh jaata.
  // Optional hai aur default khaali — baaki har caller jaisa tha waisa hi.
  // (Bilkul yahi prop ui/sheet.jsx me bhi hai, usi wajah se.)
  overlayClassName,
  children,
  showCloseButton = true,
  ...props
}) {
  return (
    <DialogPortal>
      <DialogOverlay className={overlayClassName} />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          // Mobile: a bottom sheet — full width, pinned to the bottom, sliding up.
          // `isolate` + `will-change-transform`: sheet ko apni compositing layer do, taaki
          // page ke glass cards (backdrop-filter, apni layer par) kabhi iske upar na aa
          // sakein — dekho overlay ka comment upar.
          "fixed bottom-0 left-0 isolate z-50 grid max-h-[calc(100dvh-3rem)] w-full gap-4 overflow-y-auto overscroll-contain rounded-t-2xl rounded-b-none bg-popover p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-sm text-popover-foreground ring-1 ring-foreground/10 duration-200 outline-none will-change-transform",
          "data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-bottom-10 data-closed:animate-out data-closed:fade-out-0 data-closed:slide-out-to-bottom-10",
          // sm+: a centered card — wider default (overridable via className).
          "sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:p-6 sm:pb-6 sm:max-h-[calc(100dvh-4rem)]",
          "sm:data-open:slide-in-from-bottom-0 sm:data-open:zoom-in-95 sm:data-closed:slide-out-to-bottom-0 sm:data-closed:zoom-out-95",
          className
        )}
        {...props}>
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button variant="ghost" className="absolute top-3 right-3" size="icon-sm" />
            }>
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  );
}

function DialogHeader({
  className,
  ...props
}) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1.5 pr-8", className)}
      {...props} />
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        // Negative margins mirror the Popup padding (p-5 mobile / p-6 sm+) so the
        // strip runs edge-to-edge; buttons go full-width on mobile for easy taps.
        // They also get a proper touch height on mobile: these are the Submit / Save /
        // Delete buttons, and inheriting the 32px desktop default made the most
        // consequential controls in the app the smallest targets on a phone, while
        // everything around them (check-in, task actions, approvals) sits at 40–48px.
        "-mx-5 -mb-[max(1.25rem,env(safe-area-inset-bottom))] flex flex-col-reverse gap-2 rounded-b-[inherit] border-t bg-muted/50 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:-mx-6 sm:-mb-6 sm:flex-row sm:justify-end sm:px-6 sm:pb-4 [&>button]:h-11 [&>button]:w-full sm:[&>button]:h-8 sm:[&>button]:w-auto",
        className
      )}
      {...props}>
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({
  className,
  ...props
}) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-tight font-semibold tracking-tight", className)}
      {...props} />
  );
}

function DialogDescription({
  className,
  ...props
}) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props} />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
