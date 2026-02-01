// =============================================================================
// Legistar OData Discovery + Firecrawl PDF Extraction
// =============================================================================
// Uses Legistar's OData API to find legislation, then Firecrawl to get PDF URLs
// =============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { FirecrawlDiscoveryResult } from "../_shared/types.ts";
import { createResponse, handleCors, getRequiredEnv } from "../_shared/utils.ts";

interface DiscoverRequest {
  file_numbers?: string[];
  search_terms?: string[];
  limit?: number;
  since_days?: number;
}

interface LegistarMatter {
  MatterId: number;
  MatterFile: string;
  MatterName: string;
  MatterTitle: string;
  MatterTypeName: string;
  MatterStatusName: string;
  MatterIntroDate: string;
  MatterBodyName: string;
}

interface LegistarAttachment {
  MatterAttachmentId: number;
  MatterAttachmentName: string;
  MatterAttachmentHyperlink: string;
  MatterAttachmentFileName: string;
  MatterAttachmentMatterVersion: string;
}

// SF Legistar OData API base
const ODATA_BASE = "https://webapi.legistar.com/v1/sfgov";

serve(async (req: Request) => {
  const startTime = Date.now();

  // Handle CORS
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    // Parse request body
    const body: DiscoverRequest = req.method === "POST" ? await req.json() : {};
    const limit = body.limit || 20;

    console.log(`[firecrawl-discover] Starting OData-based discovery`);

    // Build OData query - just filter by date, then filter by terms client-side
    const searchTerms = body.search_terms || ["housing", "zoning", "development", "residential", "EIR", "CEQA", "planning"];

    // OData v3 doesn't support contains(), so get all matters and filter client-side
    // Note: SF Legistar API only has data up to ~2020
    const odataUrl = `${ODATA_BASE}/Matters?$orderby=MatterIntroDate desc&$top=500`;

    console.log(`[firecrawl-discover] Querying OData: ${odataUrl}`);

    const mattersResponse = await fetch(odataUrl);

    if (!mattersResponse.ok) {
      const errorText = await mattersResponse.text();
      throw new Error(`OData API error: ${mattersResponse.status} - ${errorText}`);
    }

    const mattersData = await mattersResponse.json();
    // Legistar API returns array directly, not wrapped in { value: [...] }
    const allMatters: LegistarMatter[] = Array.isArray(mattersData) ? mattersData : (mattersData.value || []);

    console.log(`[firecrawl-discover] Fetched ${allMatters.length} matters from API`);

    // Filter matters by search terms (client-side since OData v3 doesn't support contains)
    const searchTermsLower = searchTerms.map(t => t.toLowerCase());
    const matters = allMatters.filter(matter => {
      const title = (matter.MatterTitle || "").toLowerCase();
      const name = (matter.MatterName || "").toLowerCase();
      const typeName = (matter.MatterTypeName || "").toLowerCase();
      return searchTermsLower.some(term =>
        title.includes(term) || name.includes(term) || typeName.includes(term)
      );
    });

    console.log(`[firecrawl-discover] Found ${matters.length} matching matters after filtering`);

    // Step 2: Get attachments for each matter
    const discoveredPdfs: FirecrawlDiscoveryResult[] = [];

    for (const matter of matters) {
      if (discoveredPdfs.length >= limit) break;

      console.log(`[firecrawl-discover] Getting attachments for Matter ${matter.MatterId}: ${matter.MatterFile}`);

      try {
        const attachmentsUrl = `${ODATA_BASE}/Matters/${matter.MatterId}/Attachments`;
        const attachResponse = await fetch(attachmentsUrl);

        if (attachResponse.ok) {
          const attachData = await attachResponse.json();
          // Legistar API returns array directly
          const attachments: LegistarAttachment[] = Array.isArray(attachData) ? attachData : (attachData.value || []);

          for (const attachment of attachments) {
            if (discoveredPdfs.length >= limit) break;

            // Check if it's a PDF
            const url = attachment.MatterAttachmentHyperlink;
            const fileName = attachment.MatterAttachmentFileName || attachment.MatterAttachmentName || "";

            if (url && (url.toLowerCase().includes(".pdf") || fileName.toLowerCase().includes(".pdf"))) {
              discoveredPdfs.push({
                url,
                title: attachment.MatterAttachmentName || fileName,
                file_number: matter.MatterFile,
                attachment_type: classifyAttachment(attachment.MatterAttachmentName || fileName),
                discovered_at: new Date().toISOString(),
                metadata: {
                  matter_id: matter.MatterId,
                  matter_title: matter.MatterTitle,
                  matter_type: matter.MatterTypeName,
                  matter_status: matter.MatterStatusName,
                  intro_date: matter.MatterIntroDate,
                  body_name: matter.MatterBodyName,
                },
              });
            }
          }
        }
      } catch (err) {
        console.error(`[firecrawl-discover] Error getting attachments for ${matter.MatterId}:`, err);
      }
    }

    console.log(`[firecrawl-discover] Discovered ${discoveredPdfs.length} PDF attachments`);

    return createResponse(
      {
        discovered_pdfs: discoveredPdfs,
        matters_searched: matters.length,
        total_matters_fetched: allMatters.length,
        search_terms: searchTerms,
      },
      null,
      startTime
    );

  } catch (error) {
    console.error(`[firecrawl-discover] Error:`, error);
    return createResponse(null, (error as Error).message, startTime);
  }
});

function classifyAttachment(nameOrUrl: string): string {
  const lower = nameOrUrl.toLowerCase();
  if (lower.includes("eir") || lower.includes("environmental impact")) return "EIR";
  if (lower.includes("staff report") || lower.includes("staff_report")) return "Staff Report";
  if (lower.includes("ordinance")) return "Ordinance";
  if (lower.includes("resolution")) return "Resolution";
  if (lower.includes("planning") || lower.includes("commission")) return "Planning Commission";
  if (lower.includes("noise")) return "Noise Study";
  if (lower.includes("traffic") || lower.includes("transportation")) return "Traffic Study";
  if (lower.includes("shadow")) return "Shadow Analysis";
  if (lower.includes("geotech")) return "Geotechnical Report";
  if (lower.includes("ceqa")) return "CEQA Document";
  if (lower.includes("hearing") || lower.includes("notice")) return "Public Notice";
  if (lower.includes("executive summary")) return "Executive Summary";
  if (lower.includes("motion")) return "Motion";
  if (lower.includes("amendment")) return "Amendment";
  return "Attachment";
}
