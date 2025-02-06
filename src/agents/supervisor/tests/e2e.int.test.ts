import * as ls from "langsmith/jest";
import { SimpleEvaluator } from "langsmith/jest";
import { Client } from "@langchain/langgraph-sdk";
import { Client as LSClient } from "langsmith";
import { SupervisorState } from "../supervisor-state.js";

const e2eEvaluator: SimpleEvaluator = () => {
  return {
    key: "successful_run",
    score: 1,
  };
};

ls.describe("SMA - Supervisor - E2E", () => {
  ls.test(
    "Can run end-to-end for Twitter posts",
    {
      inputs: {},
      expected: {},
    },
    async () => {
      const lsClient = new LSClient();
      const ingestDataExamples = lsClient.listExamples({
        datasetId: "4ebe89f0-f008-4d97-b8dd-86b70221ab0f",
        exampleIds: ["a112b870-6826-472e-8f67-317068d5a8bb"],
      });
      let inputs: Record<string, any> = {};
      for await (const ex of ingestDataExamples) {
        inputs = {
          ...ex.inputs,
        };
      }
      const client = new Client({
        // apiUrl: `http://localhost:${process.env.PORT || "2024"}`,
        apiUrl: "http://localhost:3000",
      });

      console.log("Before invoking supervisor graph", inputs);
      const { thread_id } = await client.threads.create();
      const result = await client.runs.wait(thread_id, "supervisor", {
        input: inputs,
        config: {
          configurable: {
            sources: ["twitter"],
          },
        },
      });
      console.log("After invoking supervisor graph");

      const { idsAndTypes } = result as SupervisorState;

      console.log("Waiting for all generate post results");
      const allGeneratePostResults = await Promise.allSettled(
        idsAndTypes.map(async ({ thread_id, run_id, type }) => {
          const result = await client.runs.join(thread_id, run_id);
          console.log(`Got generate ${type} result:\n`, result);
          return result;
        }),
      );

      await ls.expect(allGeneratePostResults).evaluatedBy(e2eEvaluator).toBe(1);
      return result;
    },
    480000, // 8 minutes
  );
});
