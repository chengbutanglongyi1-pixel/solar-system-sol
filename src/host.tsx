import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

export { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties };

export type GrokTheme = {
  kind: "dark";
  font: { family: string };
  radius: { lg: number; xl: number };
  border: { default: string };
  bg: { base: string };
};

const FONT_FAMILY =
  '"Segoe UI", system-ui, -apple-system, "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", "Microsoft YaHei", sans-serif';

const THEME: GrokTheme = {
  kind: "dark",
  font: { family: FONT_FAMILY },
  radius: { lg: 10, xl: 14 },
  border: { default: "rgba(255,255,255,0.16)" },
  bg: { base: "#05070D" },
};

export function useGrokTheme(): GrokTheme {
  return THEME;
}

export function Page(props: {
  title?: string;
  summary?: string;
  width?: string;
  lang?: string;
  children?: ReactNode;
}) {
  return (
    <div
      lang={props.lang}
      style={{
        minHeight: "100vh",
        boxSizing: "border-box",
        background: "#05070D",
        color: "#e8eefc",
        fontFamily: FONT_FAMILY,
        padding: "20px 16px 32px",
      }}
    >
      <div style={{ maxWidth: props.width === "wide" ? 1120 : 760, margin: "0 auto" }}>
        {props.title ? (
          <h1 style={{ fontSize: 28, lineHeight: 1.25, fontWeight: 650, margin: "0 0 8px" }}>{props.title}</h1>
        ) : null}
        {props.summary ? (
          <p style={{ margin: "0 0 16px", opacity: 0.82, lineHeight: 1.5, fontSize: 14 }}>{props.summary}</p>
        ) : null}
        {props.children}
      </div>
    </div>
  );
}

export function Section(props: { heading?: string; children?: ReactNode }) {
  return (
    <section
      style={{
        border: `1px solid ${THEME.border.default}`,
        borderRadius: THEME.radius.xl,
        background: THEME.bg.base,
        padding: "16px 18px",
      }}
    >
      {props.heading ? (
        <h2 style={{ fontSize: 18, lineHeight: 1.3, fontWeight: 650, margin: "0 0 8px" }}>{props.heading}</h2>
      ) : null}
      {props.children}
    </section>
  );
}

export function Text(props: { children?: ReactNode }) {
  return <p style={{ margin: 0, lineHeight: 1.5, fontSize: 14 }}>{props.children}</p>;
}
