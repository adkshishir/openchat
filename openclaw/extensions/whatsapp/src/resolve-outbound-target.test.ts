import { describe, expect, it } from "vitest";
import { resolveWhatsAppOutboundTarget } from "./resolve-outbound-target.js";

type ResolveParams = Parameters<typeof resolveWhatsAppOutboundTarget>[0];

const PRIMARY_TARGET = "+11234567890";
const SECONDARY_TARGET = "+19876543210";

describe("resolveWhatsAppOutboundTarget", () => {
  it.each([null, undefined, "", "   ", "invalid"])("rejects missing or invalid target %j", (to) => {
    expect(resolveWhatsAppOutboundTarget({ to, allowFrom: undefined, mode: undefined })).toEqual({
      ok: false,
      error: expect.objectContaining({
        message: "Delivering to WhatsApp requires target <E.164|group JID|newsletter JID>",
      }),
    });
  });

  it.each([
    ["120363123456789@g.us", "implicit"],
    ["120363999888777@g.us", "heartbeat"],
    ["120363123456789@newsletter", "implicit"],
  ])("does not apply DM allowFrom to %s in %s mode", (to, mode) => {
    expect(resolveWhatsAppOutboundTarget({ to, allowFrom: [SECONDARY_TARGET], mode })).toEqual({
      ok: true,
      to,
    });
  });

  it.each<[string, ResolveParams["allowFrom"], ResolveParams["mode"]]>([
    ["wildcard", ["*"], "implicit"],
    ["empty allowFrom", [], "implicit"],
    ["matching target", [PRIMARY_TARGET], "implicit"],
    ["numeric target", [11234567890, SECONDARY_TARGET], "implicit"],
    ["invalid entry beside matching target", ["invalid", PRIMARY_TARGET], "implicit"],
    ["whitespace in allowFrom", [`  ${PRIMARY_TARGET}  `], undefined],
    ["no policy in null mode", undefined, null],
    ["no policy in unspecified mode", undefined, undefined],
    ["matching target in heartbeat mode", [PRIMARY_TARGET], "heartbeat"],
    ["matching target in custom mode", [PRIMARY_TARGET], "broadcast"],
  ])("allows %s", (_label, allowFrom, mode) => {
    expect(resolveWhatsAppOutboundTarget({ to: PRIMARY_TARGET, allowFrom, mode })).toEqual({
      ok: true,
      to: PRIMARY_TARGET,
    });
  });

  it.each(["implicit", "heartbeat", "broadcast"])(
    "denies an unlisted target in %s mode with its normalized address",
    (mode) => {
      expect(
        resolveWhatsAppOutboundTarget({
          to: "  +1 (123) 456-7890  ",
          allowFrom: [SECONDARY_TARGET],
          mode,
        }),
      ).toEqual({
        ok: false,
        error: expect.objectContaining({
          message: `Target "${PRIMARY_TARGET}" is not listed in the configured WhatsApp allowFrom policy.`,
        }),
      });
    },
  );

  it.each([
    ["276853659042038@lid", "276853659042038@lid"],
    ["  whatsapp:276853659042038@lid  ", "276853659042038@lid"],
  ])("keeps %j addressed as a LID instead of coercing it to a phone number", (to, expected) => {
    // The local part of a LID is an opaque WhatsApp id. Reading it as E.164 produced
    // "+276853659042038", which then addressed 276853659042038@s.whatsapp.net — a
    // number the contact does not own — so a phone-number-private sender never got a reply.
    expect(resolveWhatsAppOutboundTarget({ to, allowFrom: ["*"], mode: "implicit" })).toEqual({
      ok: true,
      to: expected,
    });
  });

  it("matches a LID target against a LID allowFrom entry", () => {
    expect(
      resolveWhatsAppOutboundTarget({
        to: "276853659042038@lid",
        allowFrom: ["276853659042038@lid"],
        mode: "implicit",
      }),
    ).toEqual({ ok: true, to: "276853659042038@lid" });
    expect(
      resolveWhatsAppOutboundTarget({
        to: "276853659042038@lid",
        allowFrom: [PRIMARY_TARGET],
        mode: "implicit",
      }),
    ).toEqual({
      ok: false,
      error: expect.objectContaining({
        message: `Target "276853659042038@lid" is not listed in the configured WhatsApp allowFrom policy.`,
      }),
    });
  });

  it("trims the resolved target", () => {
    expect(
      resolveWhatsAppOutboundTarget({
        to: `  ${PRIMARY_TARGET}  `,
        allowFrom: undefined,
        mode: undefined,
      }),
    ).toEqual({ ok: true, to: PRIMARY_TARGET });
  });
});
