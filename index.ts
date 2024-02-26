// @ts-nocheck

import { BskyAgent } from "@atproto/api";
import * as dotenv from "dotenv";
import * as process from "process";
import Replicate from "replicate";
import { CronJob } from "cron";
import { promises as fsPromises } from "fs";

const USE_REPLICATE = true;

interface Agent {
  login: {
    identifier: string;
    password: string;
  };
  systemPrompt: string;
}
interface Post {
  id: number;
  title?: string; // Optional if not all posts have titles
  content: string;
  userIdentifier?: string; // Optional if not present in all posts
  strongRef?: any; // Adjust the type according to what strongRef actually is
  rootStrongRef?: any; // Same as above, adjust the type as necessary
  agentIdentifier?: string; // Optional, based on your logic
}

interface DB {
  posts: Post[];
  postCount?: number; // Assuming you're tracking the count of posts
}

interface Agents {
  [key: string]: Agent;
}

function truncateString(input: string, maxLength: number = 300): string {
  if (input.length <= maxLength) {
    return input;
  }
  return input.substring(0, maxLength);
}

interface Post {
  id: number;
  title: string;
  content: string;
}

const fileName = "./post.json";

async function savePostToFile(post: Post): Promise<void> {
  try {
    const data = JSON.stringify(post, null, 2);
    await fsPromises.writeFile(fileName, data, "utf8");
    console.log("Post saved to file");
  } catch (error) {
    console.error("An error occurred:", error);
  }
}

function removeFirstAndLastQuote(str: string): string {
  // Check if the first character is a quote
  if (str.startsWith('"') || str.startsWith("'")) {
    str = str.substring(1);
  }

  // Check if the last character is a quote
  if (str.endsWith('"') || str.endsWith("'")) {
    str = str.substring(0, str.length - 1);
  }

  return str;
}
async function readDBfromFile(): Promise<Post | null> {
  try {
    const data = await fsPromises.readFile(fileName, "utf8");
    const db: any = JSON.parse(data);
    console.log("db read from file:", db);
    return db;
  } catch (error) {
    console.error("An error occurred:", error);
    return null;
  }
}

dotenv.config();

const agent = new BskyAgent({
  service: "https://bsky.social",
});

async function main() {
  const agents: Agents = {
    "barackbeefbot.bsky.social": {
      login: {
        identifier: process.env.AGENT_1_USERNAME,
        password: process.env.AGENT_1_PASSWORD,
      },
      username: "Mark Zuckerberg",
      systemPrompt:
        "You are Mark Zuckerberg, the CEO of facebook. You are a metahuman and advanced species. You believe in your tech's superiority and aren't afraid to tell people about it",
    },
    "trumpbeefbot.bsky.social": {
      login: {
        identifier: process.env.AGENT_2_USERNAME,
        password: process.env.AGENT_2_PASSWORD,
      },
      username: "Elon Musk",
      systemPrompt:
        "You are Elon Musk. You are so rich that you don't even care anymore. You like starting arguments and think science is king.",
    },
    "bidenbeefbot.bsky.social": {
      login: {
        identifier: process.env.AGENT_3_USERNAME,
        password: process.env.AGENT_3_PASSWORD,
      },
      username: "Jason Calicanis",
      systemPrompt:
        "You are Jason Calicanis. You are a VC who is completely full of himself because he got lucky on a few investments. You think your advice is sage wisdom but say incredibly naive things all the time.",
    },
    "michellebeefbot.bsky.social": {
      login: {
        identifier: process.env.AGENT_4_USERNAME,
        password: process.env.AGENT_4_PASSWORD,
      },
      username: "Balaji Srinivasan",
      systemPrompt:
        "You are Balaji Srinivasan, legendary investor. You made a few good bets but are too deep into your own ideology. You have wild visions of the future and aren't afraid to tell other people about it.",
    },
  };

  const db = (await readDBfromFile()) as any;
  const agentNames = [...Object.keys(agents)];
  const randAgent = Math.floor(Math.random() * agentNames.length);
  console.log("randAgent:", randAgent);
  console.log("agentNames[randAgent]:", agentNames[randAgent]);

  const currAgent = agents[agentNames[randAgent]] as Agent;
  console.log("currAgent: ", currAgent);

  const postsCompiled = db.posts.reduce(
    (acc: string, post: Post, index: number, array: Post[]) => {
      const postString = `User: ${post.username}\nMessage: ${post.message}\n\n`;
      acc += postString;
      return acc;
    },
    ""
  );

  const currPrompt = `Write a short 1-2 sentence reply to this conversation. Do not include any hashtags.
  Just return the message, do not write anything other than the response. Do not write anything
  like 'sure here's my response'. Do not include the username. Do not prefix response with your name.
  Only respond in character. Only return the message.
      
  Previous Messages:
  ${postsCompiled}
  `;
  console.log("currPrompt: ", currPrompt);
  console.log("currAgent.systemPrompt: ", currAgent.systemPrompt);

  let resp = "";
  if (USE_REPLICATE) {
    const replicate = new Replicate({
      auth: process.env.REPLICATE_API_TOKEN,
    });

    const input = {
      debug: false,
      // top_k: 50,
      top_p: 1,
      prompt: currPrompt,
      temperature: 0.5,
      system_prompt: currAgent.systemPrompt,
      max_new_tokens: 500,
      min_new_tokens: -1,
    };

    for await (const event of replicate.stream("meta/llama-2-70b-chat", {
      input,
    })) {
      process.stdout.write(event.toString());
      resp += event.toString();
    }
  } else {
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

    const chatWithModel = async (
      systemPrompt: { role: string; content: string },
      messages: { role: string; content: string }[]
    ) => {
      const result = await fetch(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "neversleep/noromaid-mixtral-8x7b-instruct",
            messages: [systemPrompt, ...messages],
          }),
        }
      );
      return result.json();
    };

    const systemPrompt = {
      role: "system",
      content: currAgent.systemPrompt,
    };

    const modelResponse = await chatWithModel(systemPrompt, [
      {
        role: "user",
        content: currPrompt,
      },
    ]);

    resp = modelResponse.choices[0].message.content;
  }

  const truncatedText = removeFirstAndLastQuote(truncateString(resp));

  await agent.login({
    ...currAgent.login,
  });
  let postResp;
  if (db.posts.length == 0) {
    postResp = await agent.post({
      text: truncatedText,
    });
  } else {
    const lastPost = db.posts[db.posts.length - 1];
    lastPost.strongRef;
    const currRootStrongRef = lastPost.rootStrongRef;
    const currParentStrongRef = lastPost.strongRef;
    const currPost = {
      $type: "app.bsky.feed.post",
      text: truncatedText,
      reply: {
        root: currRootStrongRef,
        parent: currParentStrongRef,
      },
    };

    postResp = await agent.post(currPost);
  }

  console.log("Just posted! resp", postResp);

  const currRootStrongRef =
    db.posts.length === 0 ? postResp : db.posts[0].strongRef;
  const newPost: any = {
    id: db.postCount + 1,
    message: truncatedText,
    agentIdentifier: currAgent.login.identifier,
    username: currAgent.username,
    strongRef: postResp,
    rootStrongRef: currRootStrongRef,
  };

  db.posts.push(newPost);
  // console.log("saving db: ", db);

  await savePostToFile(db);
}

// Run this on a cron job
const scheduleExpressionMinute = "* * * * *"; // Run once every minute for testing
const scheduleExpression = "0 */3 * * *"; // Run once every three hours in prod
// Assuming `CronJob` supports the 6-field cron string for second-level scheduling
const scheduleExpressionEvery5Seconds = "*/5 * * * * *"; // Run every 5 seconds

const job = new CronJob(scheduleExpressionEvery5Seconds, main); // change to scheduleExpressionMinute for testing

job.start();
