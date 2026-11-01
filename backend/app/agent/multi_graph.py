"""Multi-agent mode (AGENT_MODE=multi): a supervisor agent directs specialist agents.

    intake (LLM) → supervisor (LLM) → market agent ∥ weather agent → auditor
        → supervisor (LLM): widen search → market agent again, or → calculator → explainer (LLM)

Specialists reuse the pipeline's tools, so prices, checks and money are computed exactly as in
pipeline mode; the supervisor only chooses which agents run and when to search wider."""

from collections.abc import Awaitable, Callable
from typing import Any

from langgraph.graph import END, START, StateGraph

from app.agent.nodes.audit import audit
from app.agent.nodes.compute import compute
from app.agent.nodes.execute import fetch_market, fetch_weather
from app.agent.nodes.explain import explain
from app.agent.nodes.understand import understand
from app.agent.state import AgentState
from app.agent.supervisor import supervisor_dispatch, supervisor_review
from app.agent.trace import current_agent, emit

Node = Callable[[AgentState], Awaitable[dict[str, Any]]]


def as_agent(name: str, fn: Node, intro: tuple[str, str] | None = None) -> Any:
    """Run fn as agent `name`: every trace event it emits is labelled with the agent."""

    async def run(state: AgentState) -> dict[str, Any]:
        token = current_agent.set(name)
        try:
            if intro:
                emit("tool_call", intro[0], intro[1], tool=name)
            return await fn(state)
        finally:
            current_agent.reset(token)

    return run


def after_intake(state: AgentState) -> str:
    return END if state.get("clarify") else "supervisor"


def after_review(state: AgentState) -> str:
    return "market" if state.get("widen") else "calculator"


g = StateGraph(AgentState)
g.add_node("intake", as_agent("intake", understand))
g.add_node("supervisor", as_agent("supervisor", supervisor_dispatch))
g.add_node(
    "market",
    as_agent(
        "market",
        fetch_market,
        (
            "Market agent: today's prices, 30-day history, mandis and road distances",
            "मंडी एजेंट: भाव, इतिहास, मंडियाँ और दूरी",
        ),
    ),
)
g.add_node(
    "weather",
    as_agent(
        "weather",
        fetch_weather,
        ("Weather agent: 7-day rain forecast, two models", "मौसम एजेंट: 7 दिन का पूर्वानुमान"),
    ),
)
g.add_node("auditor", as_agent("auditor", audit))
g.add_node("review", as_agent("supervisor", supervisor_review))
g.add_node("calculator", as_agent("calculator", compute))
g.add_node("explainer", as_agent("explainer", explain))

g.add_edge(START, "intake")
g.add_conditional_edges("intake", after_intake)
# market and weather run in the same step (in parallel); the auditor runs once both are done
g.add_edge("supervisor", "market")
g.add_edge("supervisor", "weather")
g.add_edge("market", "auditor")
g.add_edge("weather", "auditor")
g.add_edge("auditor", "review")
g.add_conditional_edges("review", after_review)
g.add_edge("calculator", "explainer")
g.add_edge("explainer", END)
multi_graph = g.compile()
