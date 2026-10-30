"""The agent loop:
understand → (clarify? stop) → plan → execute → audit → (repair → execute)* → compute → explain
"""

from typing import Literal

from langgraph.graph import END, START, StateGraph

from app.agent.nodes.audit import audit, needs_repair
from app.agent.nodes.compute import compute
from app.agent.nodes.execute import execute
from app.agent.nodes.explain import explain
from app.agent.nodes.plan import plan
from app.agent.nodes.repair import repair
from app.agent.nodes.understand import understand
from app.agent.state import AgentState


def after_understand(state: AgentState) -> str:
    return END if state.get("clarify") else "plan"


def after_audit(state: AgentState) -> Literal["repair", "compute"]:
    return "repair" if needs_repair(state) else "compute"


g = StateGraph(AgentState)
g.add_node("understand", understand)
g.add_node("plan", plan)
g.add_node("execute", execute)
g.add_node("audit", audit)
g.add_node("repair", repair)
g.add_node("compute", compute)
g.add_node("explain", explain)
g.add_edge(START, "understand")
g.add_conditional_edges("understand", after_understand)
g.add_edge("plan", "execute")
g.add_edge("execute", "audit")
g.add_conditional_edges("audit", after_audit)
g.add_edge("repair", "execute")
g.add_edge("compute", "explain")
g.add_edge("explain", END)
graph = g.compile()
