import Firecrawl from "@mendable/firecrawl-js";
import * as XLSX from "xlsx";
import { z } from "zod";
import fs from "fs";

const schema = z.array(
  z.object({
    firstName: z.string(),
    lastName: z.string(),
    title: z.string(),
    emailId: z.string(),
    areaOfResearchCoverage: z.string(),
    geo: z.string(),
    linkedInProfile: z.string(),
    analystFirmHq: z.string(),
  }),
);

const apiKey = process.env.FIRECRAWL_API_KEY;

if (!apiKey) {
  throw new Error("FIRECRAWL_API_KEY is not set");
}
const firecrawl = new Firecrawl({ apiKey });

type Company = {
  "Analyst Firm": string;
  Website: string;
  "Team URL": string;
  "Geo (HQ / Primary Region)": string;
};
const workbook = XLSX.readFile("./Hitachi.xlsx");
const sheetNames = workbook.SheetNames;
const sheet = sheetNames[0];
if (!sheet) {
  throw new Error("Sheet not found");
}
const sheetData: Company[] = XLSX.utils.sheet_to_json(
  workbook.Sheets[sheet] as XLSX.WorkSheet,
) as Company[];
console.log(sheetData);

async function main() {
  const results: {
    firstName: string;
    lastName: string;
    analystFirm: string;
    websiteUrl: string;
    title: string;
    emailId: string;
    areaOfResearchCoverage: string;
    geo: string;
    linkedInProfile: string;
    analystFirmHq: string;
  }[] = [];
  await Promise.all(
    sheetData.map(async (company) => {
      if (company["Team URL"]) {
        console.log(`Crawling ${company["Team URL"]}`);
        const crawlResponse = await firecrawl.crawl(company["Team URL"], {
          limit: 10,
          scrapeOptions: {
            formats: ["markdown"],
          },
        });
        let metadata = "";
        for (const datum of crawlResponse.data) {
          metadata += `## ${datum.markdown}\n\n`;
        }
        console.log("Crawling done, extracting information...");
        const agentResponse = await fetch(
          "https://agent-prod.studio.lyzr.ai/v3/inference/chat/",
          {
            method: "POST",
            body: JSON.stringify({
              user_id: "sabbyasachi@lyzr.ai",
              agent_id: "69ae9eb1920056adcb9b417c",
              session_id: "69ae9eb1920056adcb9b417c-lrnmfoel1lk",
              message: `Extract the following information from the following text: ${metadata}`,
            }),
            headers: {
              "Content-Type": "application/json",
              "x-api-key": process.env.LYZR_API_KEY!,
            },
          },
        );
        const agentResponseData = (await agentResponse.json()) as {
          response: string;
        };
        const response = JSON.parse(agentResponseData.response) as {
          analysts: {
            firstName: string;
            lastName: string;
            title: string;
            emailId: string;
            areaOfResearchCoverage: string;
            geo: string;
            linkedInProfile: string;
            analystFirmHq: string;
          }[];
        };
        console.log(`Extracted information for ${company["Website"]}...`);
        results.push(
          ...response.analysts.map((candidate) => ({
            ...candidate,
            analystFirm: company["Analyst Firm"],
            websiteUrl: company["Website"],
            analystFirmHq: company["Geo (HQ / Primary Region)"],
          })),
        );
      } else {
        console.log(`Crawling ${company["Website"]}`);
        const crawlResponse = await firecrawl.crawl(company["Website"], {
          limit: 10,
          scrapeOptions: {
            formats: ["markdown"],
          },
        });
        let metadata = "";
        for (const datum of crawlResponse.data) {
          metadata += `## ${datum.markdown}\n\n`;
        }
        console.log(
          `Crawling done, extracting information for ${company["Website"]}...`,
        );
        const agentResponse = await fetch(
          "https://agent-prod.studio.lyzr.ai/v3/inference/chat/",
          {
            method: "POST",
            body: JSON.stringify({
              user_id: "sabbyasachi@lyzr.ai",
              agent_id: "69ae9eb1920056adcb9b417c",
              session_id: "69ae9eb1920056adcb9b417c-lrnmfoel1lk",
              message: `Extract the following information from the following text: ${metadata}`,
            }),
            headers: {
              "Content-Type": "application/json",
              "x-api-key": process.env.LYZR_API_KEY!,
            },
          },
        );
        const agentResponseData = (await agentResponse.json()) as {
          response: string;
        };
        const response = JSON.parse(agentResponseData.response) as {
          analysts: {
            firstName: string;
            lastName: string;
            title: string;
            emailId: string;
            areaOfResearchCoverage: string;
            geo: string;
            linkedInProfile: string;
          }[];
        };
        results.push(
          ...response.analysts.map((candidate) => ({
            ...candidate,
            analystFirm: company["Analyst Firm"],
            websiteUrl: company["Website"],
            analystFirmHq: company["Geo (HQ / Primary Region)"],
          })),
        );
      }
    }),
  );
  console.log(JSON.stringify(results, null, 2));
  const sheet = XLSX.utils.json_to_sheet(results);
  const newWorkbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(newWorkbook, sheet, "Analysts");
  XLSX.writeFile(newWorkbook, "Hitachi-results.xlsx", { compression: true });
  console.log("Results written to Hitachi-results.xlsx");
}

main();
