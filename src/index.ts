import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import axios, { AxiosRequestConfig } from "axios";
import chalk from "chalk";
import "dotenv/config";
import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";
import OpenAI from "openai";

type Msg = { role: "system" | "user" | "assistant" | "tool"; content: string };
(async () => {
  const openai = new OpenAI({
    apiKey: process.env["OPENAI_API_KEY"],
  });
  let TOOLS: any[] = [];

  const serverConfig = JSON.parse(process.env.SERVER_CONFIG || "{}");
  const transport = new StdioClientTransport({
    ...serverConfig,
    env: {
      ...serverConfig.env,
      ...process.env,
    },
  });

  const mcpClient = new Client(
    {
      name: "contentstack-client",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );
  await mcpClient.connect(transport);

  const transformSchemaToOpenAI = (schema: any) => {
    const properties = schema.properties;
    const keys = Object.keys(properties);
    for (const key of keys) {
      const property = properties[key];
      if (property.type === "array") {
        properties[key] = {
          type: "array",
          items: {
            type: "string",
          },
        };
      }
    }
    return {
      type: "object",
      properties: properties,
      required: schema.required,
    };
  };

  const getTools = async () => {
    const tools = await mcpClient.listTools();

    TOOLS = tools.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: transformSchemaToOpenAI(tool.inputSchema),
      },
    }));
  };

  const createConfig = (
    messages: Msg[],
    stream: boolean
  ): AxiosRequestConfig => {
    return {
      method: "post",
      url: "https://api.openai.com/v1/chat/completions",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      data: {
        messages: messages,
        stream,
        // model: "o4-mini",
        // reasoning_effort: "high",
        model: "gpt-4.1", // faster
        tool_choice: "auto",
        tools: TOOLS,
      },
      responseType: stream ? "stream" : "json",
    };
  };

  const jsonResponse = async (config: AxiosRequestConfig) => {
    if (!TOOLS) {
      await getTools();
    }

    const { data, status } = await axios(config);
    if (status !== 200) {
      throw new Error(data);
    }
    // console.dir(data.choices[0], { depth: null });
    return data.choices[0];
  };

  const streamResponse = async (config: AxiosRequestConfig) => {
    const response = await axios(config);
    let assistantReply = "";
    response.data.on("data", (chunk: Buffer) => {
      const messages = chunk
        .toString()
        .split("\n")
        .reduce((acc: string[], line) => {
          line = line.trim();
          if (line && line.startsWith("data: ")) {
            acc.push(line.replace("data: ", ""));
          }
          return acc;
        }, []);

      for (const message of messages) {
        if (message === "[DONE]") return;
        try {
          const reply = JSON.parse(message).choices[0].delta.content;
          assistantReply += reply;
          process.stdout.write(reply);
        } catch (err) {
          // console.error('Error parsing message:', err);
        }
      }
    });

    response.data.on("end", () => {
      history.push({ role: "assistant", content: assistantReply });
      console.log();
      rl.prompt();
    });
    response.data.on("error", (error: Error) => {
      console.error("Stream error:", error);
      process.stdout.write(chalk.red("Error: " + error.message));
    });
  };

  const history: Msg[] = [
    {
      role: "system",
      content:
        "You are an helpful assistant which run the tools at disposal to answer the user queries. Always try to use the tools to answer the user queries. If you are not sure about the answer, ask the user to clarify.",
    },
  ];

  const rl = readline.createInterface({
    input,
    output,
    prompt: chalk.green("you> "),
  });

  console.log(chalk.blueBright('💬  Starting chat – type "exit" to quit'));
  await getTools();
  console.log(
    chalk.blueBright(
      `Tools: ${TOOLS.length}, [${TOOLS.map((tool) => tool.function.name).join(
        ", "
      )}]`
    )
  );

  rl.prompt();

  for await (const line of rl) {
    const content = line.trim();
    if (!content) {
      rl.prompt();
      continue;
    }
    if (content.toLowerCase() === "exit") break;
    history.push({ role: "user", content });

    let response = await jsonResponse(createConfig(history, false));

    while (response.message.tool_calls) {
      history.push(response.message);

      const promises = response.message.tool_calls.map(
        ({ function: func, id }) => {
          // console.dir(JSON.parse(func.arguments), { depth: null });
          console.log(
            chalk.yellowBright(
              `Running tool: ${func.name} ( ${func.arguments} )`
            )
          );
          return mcpClient
            .callTool({
              name: func.name,
              arguments: JSON.parse(func.arguments),
            })
            .then((res) => {
              // console.log(res);
              history.push({
                role: "tool",
                content: JSON.stringify(res),
                name: func.name,
                tool_call_id: id,
              });
            });
        }
      );
      await Promise.all(promises);

      response = await jsonResponse(createConfig(history, false));
    }

    process.stdout.write(chalk.cyan("ai> "));
    await streamResponse(createConfig(history, true));
  }

  rl.close();
  console.log(chalk.gray("\n👋  Chat finished – goodbye!"));
  process.exit(0);
})();
