"use server";

import { prisma } from "@dub/prisma";
import { waitUntil } from "@vercel/functions";
import { getLinkOrThrow } from "../../api/links/get-link-or-throw";
import { getProgramOrThrow } from "../../api/programs/get-program-or-throw";
import { recordLink } from "../../tinybird";
import z from "../../zod";
import { authActionClient } from "../safe-action";

const approvePartnerSchema = z.object({
  workspaceId: z.string(),
  programId: z.string(),
  partnerId: z.string(),
  linkId: z.string(),
});

// Update a partner enrollment
export const approvePartnerAction = authActionClient
  .schema(approvePartnerSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { workspace } = ctx;
    const { programId, partnerId, linkId } = parsedInput;

    const [program, link] = await Promise.all([
      getProgramOrThrow({
        workspaceId: workspace.id,
        programId,
      }),
      getLinkOrThrow({
        workspaceId: workspace.id,
        linkId,
      }),
    ]);

    if (link.programId) {
      throw new Error("Link is already associated with another partner.");
    }

    const [programEnrollment, updatedLink] = await Promise.all([
      prisma.programEnrollment.update({
        where: {
          partnerId_programId: {
            partnerId,
            programId,
          },
        },
        data: {
          status: "approved",
        },
        include: {
          partner: true,
        },
      }),

      // update link to have programId and partnerId
      prisma.link.update({
        where: {
          id: linkId,
        },
        data: {
          programId,
          partnerId,
          folderId: program.defaultFolderId,
        },
        include: {
          tags: {
            select: {
              tag: true,
            },
          },
        },
      }),
    ]);

    const partner = programEnrollment.partner;

    waitUntil(
      Promise.allSettled([
        recordLink(updatedLink),
        // TODO: [partners] Notify partner of approval?
        // TODO: send partner.created webhook
      ]),
    );

    return {
      ok: true,
    };
  });
