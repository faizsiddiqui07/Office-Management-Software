import * as React from "react"

import { cn } from "@/lib/utils"

// forwardRef zaroori hai: React 18 me `ref` props me jaata hi nahi, wo chupchap gir
// jaata hai. NoteEditor ko asli textarea chahiye — cursor kahan hai aur kya chuna hua
// hai, ye bina ref ke pata hi nahi chalta. (Button pehle se forwardRef hai; Input abhi
// nahi, par use kisi ko ref ki zaroorat nahi padi.)
const Textarea = React.forwardRef(function Textarea({
  className,
  ...props
}, ref) {
  return (
    <textarea
      ref={ref}
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-20 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-base transition-[color,border-color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive  md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50",
        className
      )}
      {...props} />
  );
});

export { Textarea }
