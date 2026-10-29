"use client";

import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MultiSelectOption {
  value: string;
  label: string;
}

interface MultiSelectProps {
  values: string[];
  onValuesChange: (values: string[]) => void;
  options: MultiSelectOption[];
  // Shown on the trigger when nothing is picked, e.g. "All sections".
  placeholder: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
}

/** Searchable multi-pick dropdown; an empty selection means "no filter". */
export function MultiSelect({
  values,
  onValuesChange,
  options,
  placeholder,
  searchPlaceholder = "Search...",
  emptyText = "No results.",
  disabled = false,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const visible = options.filter((o) => o.label.toLowerCase().includes(search.trim().toLowerCase()));
  const toggle = (value: string) =>
    onValuesChange(values.includes(value) ? values.filter((v) => v !== value) : [...values, value]);

  const label =
    values.length === 0
      ? placeholder
      : values.length === 1
        ? (options.find((o) => o.value === values[0])?.label ?? values[0])
        : `${values.length} selected`;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className={cn("truncate", values.length === 0 && "text-muted-foreground")}>{label}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-64 p-0" align="start">
        <div className="p-2">
          <Input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder={searchPlaceholder} />
        </div>
        <div className="flex items-center justify-between border-t px-3 py-1.5 text-xs">
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => onValuesChange([...new Set([...values, ...visible.map((o) => o.value)])])}
          >
            Select all{search.trim() ? " shown" : ""}
          </button>
          <button type="button" className="text-muted-foreground hover:underline" onClick={() => onValuesChange([])}>
            Clear
          </button>
        </div>
        <div className="max-h-60 overflow-y-auto border-t">
          {visible.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">{emptyText}</p>
          ) : (
            visible.map((o) => (
              <label key={o.value} className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-accent">
                <Checkbox checked={values.includes(o.value)} onCheckedChange={() => toggle(o.value)} />
                <span className="truncate">{o.label}</span>
              </label>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
