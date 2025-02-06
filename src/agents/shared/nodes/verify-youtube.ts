import { z } from "zod";
import { LangGraphRunnableConfig } from "@langchain/langgraph";
import { GeneratePostAnnotation } from "../../generate-post/generate-post-state.js";
import { ChatVertexAI } from "@langchain/google-vertexai-web";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";
import { getPrompts } from "../../generate-post/prompts/index.js";
import { VerifyContentAnnotation } from "../shared-state.js";
import {
  getVideoThumbnailUrl,
  getYouTubeVideoDuration,
} from "./youtube.utils.js";

type VerifyYouTubeContentReturn = {
  relevantLinks: (typeof GeneratePostAnnotation.State)["relevantLinks"];
  pageContents: (typeof GeneratePostAnnotation.State)["pageContents"];
};

const GENERATE_REPORT_PROMPT = `You are a highly regarded marketing employee at a large software company.
You have been assigned the provided YouTube video, and you need to generate a summary report of the content in the video.
Specifically, you should be focusing on the technical details, why people should care about it, and any problems it solves.
You should also focus on the products the video might talk about (although not all videos will have your company content).

${getPrompts().businessContext}

Given this context, examine the YouTube videos contents closely, and generate a report on the video.
For context, this report will be used to generate a Tweet and LinkedIn post promoting the video and the company products it uses, if any.
Ensure to include in your report if this video is relevant to your company's products, and if so, include content in your report on what the video covered in relation to your company's products.`;

const VERIFY_RELEVANT_CONTENT_PROMPT = `You are a highly regarded marketing employee.
You're given a summary/report on some content a third party submitted to you in hopes of having it promoted by you.
You need to verify if the content is relevant to the following context before approving or denying the request.

${getPrompts().businessContext}

${getPrompts().contentValidationPrompt}

Given this context, examine the summary/report closely, and determine if the content is relevant to your company's products.
You should provide reasoning as to why or why not the content is relevant to your company's products, then a simple true or false for whether or not it's relevant.
`;

const RELEVANCY_SCHEMA = z
  .object({
    reasoning: z
      .string()
      .describe(
        "Reasoning for why the content is or isn't relevant to your company's products.",
      ),
    relevant: z
      .boolean()
      .describe(
        "Whether or not the content is relevant to your company's products.",
      ),
  })
  .describe("The relevancy of the content to your company's products.");

export async function generateVideoSummary(url: string): Promise<string> {
  const model = new ChatVertexAI({
    model: "gemini-1.5-flash",
    temperature: 0,
  });

  const mediaMessage = new HumanMessage({
    content: [
      {
        type: "text",
        text: "Here is the YouTube video",
      },
      {
        type: "media",
        mimeType: "video/mp4",
        fileUri: url,
      },
    ],
  });

  const summaryResult = await model
    .withConfig({
      runName: "generate-video-summary-model",
    })
    .invoke([
      {
        role: "system",
        content: GENERATE_REPORT_PROMPT,
      },
      mediaMessage,
    ]);
  return summaryResult.content as string;
}

export async function verifyYouTubeContentIsRelevant(
  summary: string,
): Promise<boolean> {
  const relevancyModel = new ChatOpenAI({
    model: "gpt-4o-mini",
    temperature: 0.3,
}).withStructuredOutput(RELEVANCY_SCHEMA, {
    name: "relevancy",
  });

  const { relevant } = await relevancyModel
    .withConfig({
      runName: "check-video-relevancy-model",
    })
    .invoke([
      {
        role: "system",
        content: VERIFY_RELEVANT_CONTENT_PROMPT,
      },
      {
        role: "user",
        content: summary,
      },
    ]);
  return relevant;
}

/**
 * Verifies the content provided is relevant to your company's products.
 */
export async function verifyYouTubeContent(
  state: typeof VerifyContentAnnotation.State,
  _config: LangGraphRunnableConfig,
): Promise<VerifyYouTubeContentReturn> {
  const [videoDurationS, videoThumbnail] = await Promise.all([
    getYouTubeVideoDuration(state.link),
    getVideoThumbnailUrl(state.link),
  ]);
  if (videoDurationS === undefined) {
    // TODO: Handle this better
    throw new Error("Failed to get video duration");
  }

  // 1800 = 30 minutes
  if (videoDurationS > 1800) {
    // TODO: Replace with interrupt requesting user confirm if they want to continue
    throw new Error(
      "Video is longer than 30 minutes, please confirm you want to continue.",
    );
  }

  const videoSummary = await generateVideoSummary(state.link);
  const relevant = await verifyYouTubeContentIsRelevant(videoSummary);

  if (relevant) {
    return {
      relevantLinks: [state.link],
      pageContents: [videoSummary as string],
      ...(videoThumbnail ? { imageOptions: [videoThumbnail] } : {}),
    };
  }

  // Not relevant, return empty arrays so this URL is not included.
  return {
    relevantLinks: [],
    pageContents: [],
  };
}
