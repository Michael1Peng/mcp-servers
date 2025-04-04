#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Define memory file path using environment variable with fallback
const defaultMemoryPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'memory.json');

// If MEMORY_FILE_PATH is just a filename, put it in the same directory as the script
const MEMORY_FILE_PATH = process.env.MEMORY_FILE_PATH
  ? path.isAbsolute(process.env.MEMORY_FILE_PATH)
    ? process.env.MEMORY_FILE_PATH
    : path.join(path.dirname(fileURLToPath(import.meta.url)), process.env.MEMORY_FILE_PATH)
  : defaultMemoryPath;

// We are storing our memory using entities, relations, and observations in a graph structure
interface Entity {
  name: string;
  entityType: string;
  observations: string[];
}

interface Relation {
  from: string;
  to: string;
  relationType: string;
}

interface KnowledgeGraph {
  entities: Entity[];
  relations: Relation[];
}

// The KnowledgeGraphManager class contains all operations to interact with the knowledge graph
class KnowledgeGraphManager {
  private async loadGraph(): Promise<KnowledgeGraph> {
    console.error(`[KnowledgeGraphManager] Loading graph from ${MEMORY_FILE_PATH}`);
    try {
      const data = await fs.readFile(MEMORY_FILE_PATH, "utf-8");
      const lines = data.split("\n").filter(line => line.trim() !== "");
      return lines.reduce((graph: KnowledgeGraph, line) => {
        const item = JSON.parse(line);
        if (item.type === "entity") graph.entities.push(item as Entity);
        if (item.type === "relation") graph.relations.push(item as Relation);
        return graph;
      }, { entities: [], relations: [] });
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as any).code === "ENOENT") {
        console.error(`[KnowledgeGraphManager] Memory file not found at ${MEMORY_FILE_PATH}, starting with empty graph.`);
        return { entities: [], relations: [] };
      }
      console.error(`[KnowledgeGraphManager] Error loading graph:`, error);
      throw error;
    }
  }

  private async saveGraph(graph: KnowledgeGraph): Promise<void> {
    console.error(`[KnowledgeGraphManager] Saving graph to ${MEMORY_FILE_PATH}`);
    try {
      const lines = [
        ...graph.entities.map(e => JSON.stringify({ type: "entity", ...e })),
        ...graph.relations.map(r => JSON.stringify({ type: "relation", ...r })),
      ];
      await fs.writeFile(MEMORY_FILE_PATH, lines.join("\n"));
      console.error(`[KnowledgeGraphManager] Graph saved successfully.`);
    } catch (error) {
        console.error(`[KnowledgeGraphManager] Error saving graph:`, error);
        throw error;
    }
  }

  async createEntities(entities: Entity[]): Promise<Entity[]> {
    console.error(`[KnowledgeGraphManager] createEntities called with:`, JSON.stringify(entities, null, 2));
    const graph = await this.loadGraph();
    const newEntities = entities.filter(e => !graph.entities.some(existingEntity => existingEntity.name === e.name));
    graph.entities.push(...newEntities);
    await this.saveGraph(graph);
    console.error(`[KnowledgeGraphManager] createEntities result:`, JSON.stringify(newEntities, null, 2));
    return newEntities;
  }

  async createRelations(relations: Relation[]): Promise<Relation[]> {
    console.error(`[KnowledgeGraphManager] createRelations called with:`, JSON.stringify(relations, null, 2));
    const graph = await this.loadGraph();
    const newRelations = relations.filter(r => !graph.relations.some(existingRelation =>
      existingRelation.from === r.from &&
      existingRelation.to === r.to &&
      existingRelation.relationType === r.relationType
    ));
    graph.relations.push(...newRelations);
    await this.saveGraph(graph);
    console.error(`[KnowledgeGraphManager] createRelations result:`, JSON.stringify(newRelations, null, 2));
    return newRelations;
  }

  async addObservations(observations: { entityName: string; contents: string[] }[]): Promise<{ entityName: string; addedObservations: string[] }[]> {
    console.error(`[KnowledgeGraphManager] addObservations called with:`, JSON.stringify(observations, null, 2));
    const graph = await this.loadGraph();
    const results = observations.map(o => {
      const entity = graph.entities.find(e => e.name === o.entityName);
      if (!entity) {
        console.error(`[KnowledgeGraphManager] addObservations error: Entity ${o.entityName} not found`);
        throw new Error(`Entity with name ${o.entityName} not found`);
      }
      const newObservations = o.contents.filter(content => !entity.observations.includes(content));
      entity.observations.push(...newObservations);
      return { entityName: o.entityName, addedObservations: newObservations };
    });
    await this.saveGraph(graph);
    console.error(`[KnowledgeGraphManager] addObservations result:`, JSON.stringify(results, null, 2));
    return results;
  }

  async deleteEntities(entityNames: string[]): Promise<void> {
    console.error(`[KnowledgeGraphManager] deleteEntities called with:`, JSON.stringify(entityNames, null, 2));
    const graph = await this.loadGraph();
    graph.entities = graph.entities.filter(e => !entityNames.includes(e.name));
    graph.relations = graph.relations.filter(r => !entityNames.includes(r.from) && !entityNames.includes(r.to));
    await this.saveGraph(graph);
    console.error(`[KnowledgeGraphManager] deleteEntities completed.`);
  }

  async deleteObservations(deletions: { entityName: string; observations: string[] }[]): Promise<void> {
    console.error(`[KnowledgeGraphManager] deleteObservations called with:`, JSON.stringify(deletions, null, 2));
    const graph = await this.loadGraph();
    deletions.forEach(d => {
      const entity = graph.entities.find(e => e.name === d.entityName);
      if (entity) {
        entity.observations = entity.observations.filter(o => !d.observations.includes(o));
      } else {
         console.error(`[KnowledgeGraphManager] deleteObservations warning: Entity ${d.entityName} not found during deletion.`);
      }
    });
    await this.saveGraph(graph);
    console.error(`[KnowledgeGraphManager] deleteObservations completed.`);
  }

  async deleteRelations(relations: Relation[]): Promise<void> {
    console.error(`[KnowledgeGraphManager] deleteRelations called with:`, JSON.stringify(relations, null, 2));
    const graph = await this.loadGraph();
    graph.relations = graph.relations.filter(r => !relations.some(delRelation =>
      r.from === delRelation.from &&
      r.to === delRelation.to &&
      r.relationType === delRelation.relationType
    ));
    await this.saveGraph(graph);
    console.error(`[KnowledgeGraphManager] deleteRelations completed.`);
  }

  async readGraph(): Promise<KnowledgeGraph> {
    console.error(`[KnowledgeGraphManager] readGraph called`);
    const graph = await this.loadGraph();
    console.error(`[KnowledgeGraphManager] readGraph result:`, JSON.stringify(graph, null, 2));
    return graph;
  }

  // Very basic search function
  async searchNodes(query: string): Promise<KnowledgeGraph> {
    console.error(`[KnowledgeGraphManager] searchNodes called with query:`, query);
    const graph = await this.loadGraph();

    // Filter entities
    const filteredEntities = graph.entities.filter(e =>
      e.name.toLowerCase().includes(query.toLowerCase()) ||
      e.entityType.toLowerCase().includes(query.toLowerCase()) ||
      e.observations.some(o => o.toLowerCase().includes(query.toLowerCase()))
    );

    // Create a Set of filtered entity names for quick lookup
    const filteredEntityNames = new Set(filteredEntities.map(e => e.name));

    // Filter relations to only include those between filtered entities
    const filteredRelations = graph.relations.filter(r =>
      filteredEntityNames.has(r.from) && filteredEntityNames.has(r.to)
    );

    const filteredGraph: KnowledgeGraph = {
      entities: filteredEntities,
      relations: filteredRelations,
    };

    console.error(`[KnowledgeGraphManager] searchNodes result:`, JSON.stringify(filteredGraph, null, 2));
    return filteredGraph;
  }

  async openNodes(names: string[]): Promise<KnowledgeGraph> {
    console.error(`[KnowledgeGraphManager] openNodes called with names:`, JSON.stringify(names, null, 2));
    const graph = await this.loadGraph();

    // Filter entities
    const filteredEntities = graph.entities.filter(e => names.includes(e.name));

    // Create a Set of filtered entity names for quick lookup
    const filteredEntityNames = new Set(filteredEntities.map(e => e.name));

    // Filter relations to only include those between filtered entities
    const filteredRelations = graph.relations.filter(r =>
      filteredEntityNames.has(r.from) && filteredEntityNames.has(r.to)
    );

    const filteredGraph: KnowledgeGraph = {
      entities: filteredEntities,
      relations: filteredRelations,
    };

    console.error(`[KnowledgeGraphManager] openNodes result:`, JSON.stringify(filteredGraph, null, 2));
    return filteredGraph;
  }
}

const knowledgeGraphManager = new KnowledgeGraphManager();


// The server instance and tools exposed to Claude
const server = new Server({
  name: "memory-server",
  version: "1.0.0",
},    {
    capabilities: {
      tools: {},
    },
  },);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  console.error('[Server] Received ListTools request');
  const toolsList = [
      {
        name: "create_entities",
        description: "Create multiple new entities in the knowledge graph",
        inputSchema: {
          type: "object",
          properties: {
            entities: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string", description: "The name of the entity" },
                  entityType: { type: "string", description: "The type of the entity" },
                  observations: {
                    type: "array",
                    items: { type: "string" },
                    description: "An array of observation contents associated with the entity"
                  },
                },
                required: ["name", "entityType", "observations"],
              },
            },
          },
          required: ["entities"],
        },
      },
      {
        name: "create_relations",
        description: "Create multiple new relations between entities in the knowledge graph. Relations should be in active voice",
        inputSchema: {
          type: "object",
          properties: {
            relations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  from: { type: "string", description: "The name of the entity where the relation starts" },
                  to: { type: "string", description: "The name of the entity where the relation ends" },
                  relationType: { type: "string", description: "The type of the relation" },
                },
                required: ["from", "to", "relationType"],
              },
            },
          },
          required: ["relations"],
        },
      },
      {
        name: "add_observations",
        description: "Add new observations to existing entities in the knowledge graph",
        inputSchema: {
          type: "object",
          properties: {
            observations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  entityName: { type: "string", description: "The name of the entity to add the observations to" },
                  contents: {
                    type: "array",
                    items: { type: "string" },
                    description: "An array of observation contents to add"
                  },
                },
                required: ["entityName", "contents"],
              },
            },
          },
          required: ["observations"],
        },
      },
      {
        name: "delete_entities",
        description: "Delete multiple entities and their associated relations from the knowledge graph",
        inputSchema: {
          type: "object",
          properties: {
            entityNames: {
              type: "array",
              items: { type: "string" },
              description: "An array of entity names to delete"
            },
          },
          required: ["entityNames"],
        },
      },
      {
        name: "delete_observations",
        description: "Delete specific observations from entities in the knowledge graph",
        inputSchema: {
          type: "object",
          properties: {
            deletions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  entityName: { type: "string", description: "The name of the entity containing the observations" },
                  observations: {
                    type: "array",
                    items: { type: "string" },
                    description: "An array of observations to delete"
                  },
                },
                required: ["entityName", "observations"],
              },
            },
          },
          required: ["deletions"],
        },
      },
      {
        name: "delete_relations",
        description: "Delete multiple relations from the knowledge graph",
        inputSchema: {
          type: "object",
          properties: {
            relations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  from: { type: "string", description: "The name of the entity where the relation starts" },
                  to: { type: "string", description: "The name of the entity where the relation ends" },
                  relationType: { type: "string", description: "The type of the relation" },
                },
                required: ["from", "to", "relationType"],
              },
              description: "An array of relations to delete"
            },
          },
          required: ["relations"],
        },
      },
      {
        name: "read_graph",
        description: "Read the entire knowledge graph",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "search_nodes",
        description: "Search for nodes in the knowledge graph based on a query",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "The search query to match against entity names, types, and observation content" },
          },
          required: ["query"],
        },
      },
      {
        name: "open_nodes",
        description: "Open specific nodes in the knowledge graph by their names",
        inputSchema: {
          type: "object",
          properties: {
            names: {
              type: "array",
              items: { type: "string" },
              description: "An array of entity names to retrieve",
            },
          },
          required: ["names"],
        },
      },
    ];
  console.error('[Server] Responding to ListTools request with:', JSON.stringify(toolsList, null, 2));
  return { tools: toolsList };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  console.error(`[Server] Received CallTool request for tool: ${name}`);
  console.error('[Server] Arguments:', JSON.stringify(args, null, 2));

  if (!args) {
    console.error(`[Server] Error: No arguments provided for tool: ${name}`);
    throw new Error(`No arguments provided for tool: ${name}`);
  }

  try {
    let result: any;
    let responseText: string;

    switch (name) {
      case "create_entities":
        result = await knowledgeGraphManager.createEntities(args.entities as Entity[]);
        responseText = JSON.stringify(result, null, 2);
        console.error('[Server] Responding to create_entities:', responseText);
        return { content: [{ type: "text", text: responseText }] };
      case "create_relations":
        result = await knowledgeGraphManager.createRelations(args.relations as Relation[]);
        responseText = JSON.stringify(result, null, 2);
        console.error('[Server] Responding to create_relations:', responseText);
        return { content: [{ type: "text", text: responseText }] };
      case "add_observations":
        result = await knowledgeGraphManager.addObservations(args.observations as { entityName: string; contents: string[] }[]);
        responseText = JSON.stringify(result, null, 2);
        console.error('[Server] Responding to add_observations:', responseText);
        return { content: [{ type: "text", text: responseText }] };
      case "delete_entities":
        await knowledgeGraphManager.deleteEntities(args.entityNames as string[]);
        responseText = "Entities deleted successfully";
        console.error('[Server] Responding to delete_entities:', responseText);
        return { content: [{ type: "text", text: responseText }] };
      case "delete_observations":
        await knowledgeGraphManager.deleteObservations(args.deletions as { entityName: string; observations: string[] }[]);
        responseText = "Observations deleted successfully";
        console.error('[Server] Responding to delete_observations:', responseText);
        return { content: [{ type: "text", text: responseText }] };
      case "delete_relations":
        await knowledgeGraphManager.deleteRelations(args.relations as Relation[]);
        responseText = "Relations deleted successfully";
        console.error('[Server] Responding to delete_relations:', responseText);
        return { content: [{ type: "text", text: responseText }] };
      case "read_graph":
        result = await knowledgeGraphManager.readGraph();
        responseText = JSON.stringify(result, null, 2);
        console.error('[Server] Responding to read_graph:', responseText);
        return { content: [{ type: "text", text: responseText }] };
      case "search_nodes":
        result = await knowledgeGraphManager.searchNodes(args.query as string);
        responseText = JSON.stringify(result, null, 2);
        console.error('[Server] Responding to search_nodes:', responseText);
        return { content: [{ type: "text", text: responseText }] };
      case "open_nodes":
        result = await knowledgeGraphManager.openNodes(args.names as string[]);
        responseText = JSON.stringify(result, null, 2);
        console.error('[Server] Responding to open_nodes:', responseText);
        return { content: [{ type: "text", text: responseText }] };
      default:
        console.error(`[Server] Error: Unknown tool requested: ${name}`);
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
      console.error(`[Server] Error processing tool ${name}:`, error);
      // Propagate the error back to the client
      throw error;
  }
});

async function main() {
  console.error("Starting Knowledge Graph MCP Server...");
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Knowledge Graph MCP Server connected via stdio transport.");
}

main().catch((error) => {
  console.error("Fatal error during server startup or connection:", error);
  process.exit(1);
});
