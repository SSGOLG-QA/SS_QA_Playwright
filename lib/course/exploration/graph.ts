// 상태그래프 — 노드(stateKey)·엣지(Transition)·방문수. results/state-graph.json 영속.
import * as fs from 'fs';
import * as path from 'path';
import type { ExplorerState, Transition } from './types';
import { stateKey } from './observe';

interface GraphNode { key: string; feature: string; sub: string; businessState: string; url: string; visits: number; }

export class StateGraph {
  readonly nodes = new Map<string, GraphNode>();
  readonly edges: Transition[] = [];

  addState(s: ExplorerState): string {
    const k = stateKey(s);
    const n = this.nodes.get(k);
    if (n) n.visits++;
    else this.nodes.set(k, { key: k, feature: s.feature, sub: s.sub, businessState: s.businessState, url: s.url, visits: 1 });
    return k;
  }

  addTransition(from: string, action: string, to: string): void {
    this.edges.push({ from, action, to, ts: new Date().toISOString() });
  }

  isNew(s: ExplorerState): boolean { return !this.nodes.has(stateKey(s)); }

  // from 상태에서 특정 트리거 라벨로 나간 전이 수(미방문/반복 감쇠 판정용). 엣지 action=`라벨[kind]`.
  countTransition(from: string, label: string): number {
    return this.edges.filter((e) => e.from === from && e.action.startsWith(label + '[')).length;
  }

  persist(file: string): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({
      generatedAt: new Date().toISOString(),
      nodeCount: this.nodes.size,
      edgeCount: this.edges.length,
      nodes: Array.from(this.nodes.values()),
      edges: this.edges,
    }, null, 2), 'utf8');
  }
}
