import { ChatOpenAI } from "@langchain/openai";
import { getPrompts } from "../../generate-post/prompts/index.js";
import { VerifyRedditGraphState } from "../types.js";
import { z } from "zod";
import { convertPostToString, formatComments } from "../utils.js";

const VALIDATE_REDDIT_POST_PROMPT = `You are a highly regarded marketing employee.
You're provided with a Reddit post, and some of the comments (not guaranteed, some Reddit posts don't have comments).
Additionally, if the Reddit post contains links to other webpages, you'll be provided with the content of those webpages.

Now, given all of this context, your task is to determine whether or not the post & optionally linked content is relevant to the context outlined below:
${getPrompts().businessContext}

${getPrompts().contentValidationPrompt}

You should carefully read over all of the content submitted to you, and determine whether or not the content is actually relevant to you.
You should provide reasoning as to why or why not the post & additional content is relevant to you, then a simple true or false for whether or not it is relevant.`;

const RELEVANCY_SCHEMA = z
  .object({
    reasoning: z
      .string()
      .describe(
        "Reasoning for why the content from the Reddit post is or isn't relevant to your business context.",
      ),
    relevant: z
      .boolean()
      .describe(
        "Whether or not the content from the Reddit post is relevant to your business context.",
      ),
  })
  .describe("The relevancy of the content to your business context.");

function formatUserPrompt(state: VerifyRedditGraphState) {
  if (!state.redditPost) {
    throw new Error("No reddit post found");
  }

  const formattedPost = `<reddit_post>
${state.redditPost.post.title}
${state.redditPost.post.selftext}
</reddit_post>`;
  const formattedComments = state.redditPost.comments?.length
    ? `<reddit_post_comments>
${formatComments(state.redditPost.comments)}
</reddit_post_comments>`
    : "";
  const fullFormattedPost = `${formattedPost}\n${formattedComments}`;

  const formattedExternalContent = state.pageContents?.length
    ? state.pageContents
        .map(
          (
            c,
            idx,
          ) => `<external_content${state.relevantLinks?.[idx] ? ` url="${state.relevantLinks[idx]}"` : ""}>
${c}
</external_content>`,
        )
        .join("\n")
    : "";

  const fullPrompt = `${fullFormattedPost}\n\n${formattedExternalContent}`;
  return fullPrompt;
}

export async function validateRedditPost(
  state: VerifyRedditGraphState,
): Promise<Partial<VerifyRedditGraphState>> {
  const model =  new ChatOpenAI({
    model: "gpt-4o-mini",
    temperature: 0.3,
}).withStructuredOutput(RELEVANCY_SCHEMA, {
    name: "relevancy",
  });

  const formattedUserPrompt = formatUserPrompt(state);

  const result = await model.invoke([
    {
      role: "system",
      content: VALIDATE_REDDIT_POST_PROMPT,
    },
    {
      role: "user",
      content: formattedUserPrompt,
    },
  ]);

  if (result.relevant) {
    // If true, return nothing so the state is not effected.
    return {
      relevantLinks: [...state.externalURLs],
      pageContents: [
        ...(state.redditPost ? [convertPostToString(state.redditPost)] : []),
      ],
    };
  }

  // If the content is not relevant, reset the state so it contains empty values
  return {
    redditPost: undefined,
    externalURLs: undefined,
    relevantLinks: undefined,
    pageContents: undefined,
    imageOptions: undefined,
  };
}
