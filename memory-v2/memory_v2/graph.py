"""The reflection graph."""

from typing import Any, Dict

from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph
from langgraph.store.base import BaseStore
from langmem.prompts.looping import (
    Prompt,
    create_prompt_optimizer,
)

from memory_v2.state import State


REFLECTIONS_NAMESPACE = ("reflection_rules",)
REFLECTIONS_KEY = "rules"
PROMPT_KEY = "prompt"


async def aget_reflections(store: BaseStore) -> str:
    """Get reflections from the store."""
    reflections = await store.aget(REFLECTIONS_NAMESPACE, REFLECTIONS_KEY)

    if not reflections:
        return "No prompt rules have been created yet."

    ruleset = reflections.value.get(
        PROMPT_KEY, "No prompt rules have been created yet."
    )

    return ruleset


async def aput_reflections(store: BaseStore, reflections: str) -> None:
    """Put reflections in the store."""
    await store.aput(REFLECTIONS_NAMESPACE, REFLECTIONS_KEY, {PROMPT_KEY: reflections})


async def reflection(state: State, store: BaseStore) -> Dict[str, Any]:
    """Process reflection and update rules based on user interaction."""
    model = ChatOpenAI(model="gpt-4o-mini", temperature=0)
    current_reflections_prompt = await aget_reflections(store)

    update_instructions = """Analyze the following to determine if rules prompt updates are needed:
1. Current rules prompt (current_prompt)
2. Generated social media post (session)
3. User feedback on the post (feedback)

If the user's feedback explicitly requests changes:
1. Create or update rules that directly address the feedback
2. Keep each rule clear, specific, and concise
3. If a new rule conflicts with an existing one, use the new rule
4. Only add rules that are explicitly mentioned in the user's feedback

Guidelines for updates:
- Do not infer or assume rules beyond what's explicitly stated
- Do not add rules based on implicit feedback
- Do not overgeneralize the feedback
- Combine existing rules if it improves clarity without losing specificity

Output only the updated rules prompt, with no additional context or instructions."""

    feedback = state.user_response

    prompt = Prompt(
        name="Update Prompt",
        prompt=current_reflections_prompt,
        update_instructions=update_instructions,
        feedback=feedback,
    )

    sessions = state.original_post

    optimizer = create_prompt_optimizer(model, kind="metaprompt")

    result = await optimizer(sessions, prompt)

    await aput_reflections(store, result)

    return {}


# Define a new graph
workflow = StateGraph(State)
workflow.add_node("reflection", reflection)
workflow.add_edge("__start__", "reflection")

graph = workflow.compile()
graph.name = "Reflection Graph"
