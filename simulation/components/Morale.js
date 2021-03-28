function Morale() {}

Morale.prototype.Schema =
	"<a:help>Deals with Morale.</a:help>" +
	"<a:example>" +
		"<Max>100</Max>" +
		"<RegenRate>1.0</RegenRate>" +
		"<IdleRegenRate>0</IdleRegenRate>" +
		"<Range>10</Range>" +
	"</a:example>" +
	"<element name='Max' a:help='Maximum Morale.'>" +
		"<ref name='nonNegativeDecimal'/>" +
	"</element>" +
	"<optional>" +
		"<element name='Initial' a:help='Initial Morale. Default if unspecified is equal to Max.'>" +
			"<ref name='nonNegativeDecimal'/>" +
		"</element>" +
	"</optional>" +
	"<optional>" +
		"<element name='Significance' a:help='The rate of unit morale influence to other units in range. Default to 1.'>" +
			"<ref name='nonNegativeDecimal'/>" +
		"</element>" +
	"</optional>" +
	"<element name='RegenRate' a:help='Morale regeneration rate per second.'>" +
		"<data type='decimal'/>" +
	"</element>" +
	"<element name='IdleRegenRate' a:help='Morale regeneration rate per second when idle or garrisoned.'>" +
		"<data type='decimal'/>" +
	"</element>" +
	"<optional>" +
		"<element name='Range' a:help='Range of morale influence.'>" +
			"<data type='decimal'/>" +
		"</element>" +
	"</optional>";

Morale.prototype.Init = function()
{
	this.affectedPlayers = [];
	this.affectedPlayersEnemies = [];

	// Cache this value so it allows techs to maintain previous morale level
	this.maxMorale = +this.template.Max;
	// Default to <Initial>, but use <Max> if it's undefined or zero
	this.Morale = +(this.template.Initial || this.GetMaxMorale());

	this.regenRate = ApplyValueModificationsToEntity("Morale/RegenRate", +this.template.RegenRate, this.entity);
	this.idleRegenRate = ApplyValueModificationsToEntity("Morale/IdleRegenRate", +this.template.IdleRegenRate, this.entity);
	this.significance = +(this.template.Significance || 1);

	this.moraleRegenMultiplier = 0.2; // Morale influence regen multiplier
	this.moraleDeathDamageMultiplier = 100; // Morale damage on death (multiplied from morale influence)
	this.moraleDamageAttacked = 0.5; //Morale damage on attacked
	this.moraleLevelEffectThreshold = 2; // Morale level on which Demoralized effect is applied

	this.CheckMoraleRegenTimer();	
	this.CleanMoraleInfluence();
};

Morale.prototype.GetMorale = function()
{
	return this.Morale;
};

Morale.prototype.GetMoraleLevel = function()
{
	return this.Morale == 0 ? 1 : Math.ceil(this.Morale / 20);
};

Morale.prototype.GetMaxMorale = function()
{
	return this.maxMorale;
};

Morale.prototype.SetMorale = function(value)
{
	let old = this.Morale;
	this.Morale = Math.max(1, Math.min(this.GetMaxMorale(), value));
	this.RegisterMoraleChanged(old);
};

Morale.prototype.GetIdleRegenRate = function()
{
	return this.idleRegenRate;
};

Morale.prototype.GetRegenRate = function()
{
	return this.regenRate;
};

Morale.prototype.GetSignificance = function()
{
	return this.significance;
};

Morale.prototype.GetMoraleDamageAttacked = function()
{
	return this.moraleDamageAttacked;
};

Morale.prototype.GetRange = function(ent)
{
	let cmpVision = Engine.QueryInterface(this.entity, IID_Vision);
	if (!cmpVision)
		return false;
	return cmpVision.GetRange() / 2;
}

Morale.prototype.ExecuteRegeneration = function()
{
	let regen = this.GetRegenRate();
	if (this.GetIdleRegenRate() != 0)
	{
		let cmpUnitAI = Engine.QueryInterface(this.entity, IID_UnitAI);
		if (cmpUnitAI && (cmpUnitAI.IsIdle() || cmpUnitAI.IsGarrisoned() && !cmpUnitAI.IsTurret()))
			regen += this.GetIdleRegenRate();
	}

	if (regen > 0)
		this.IncreaseMorale(regen);
	else
		this.ReduceMorale(-regen);

	let moraleLevel = this.GetMoraleLevel()
	var cmpModifiersManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_ModifiersManager);
    if (moraleLevel <= this.moraleLevelEffectThreshold)
		this.ApplyMoraleEffects(this.entity)
    else
    	this.RemoveMoraleEffects(this.entity)	
};

/*
 * Check if the regeneration timer needs to be started or stopped
 */
Morale.prototype.CheckMoraleRegenTimer = function()
{
	// check if we need a timer
	if (this.GetRegenRate() == 0 && this.GetIdleRegenRate() == 0 ||
	    this.Morale == this.GetMaxMorale() && this.GetRegenRate() >= 0 && this.GetIdleRegenRate() >= 0)
	{
		// we don't need a timer, disable if one exists
		if (this.regenTimer)
		{
			let cmpTimer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer);
			cmpTimer.CancelTimer(this.regenTimer);
			this.regenTimer = undefined;
		}
		return;
	}

	// we need a timer, enable if one doesn't exist
	if (this.regenTimer)
		return;

	let cmpTimer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer);
	this.regenTimer = cmpTimer.SetInterval(this.entity, IID_Morale, "ExecuteRegeneration", 1000, 1000, null);
};

/**
 * @param {number} amount - The amount of Morale to substract. Stop reduction once reached 0.
 * @return {{ MoraleChange:number }} -  Number of Morale points lost.
 */
Morale.prototype.ReduceMorale = function(amount)
{
	if (!amount || !this.Morale)
		return { "MoraleChange": 0 };

	let oldMorale = this.Morale;
	// If we reached 0, then stop reducing.
	if (amount >= this.Morale)
	{
		this.Morale = 0;
		this.RegisterMoraleChanged(oldMorale);
		return { "MoraleChange": -oldMorale };
	}

	this.Morale -= amount;
	this.RegisterMoraleChanged(oldMorale);
	return { "MoraleChange": this.Morale - oldMorale };
};


Morale.prototype.IncreaseMorale = function(amount)
{
	let old = this.Morale;
	this.Morale = Math.min(this.Morale + amount, this.GetMaxMorale());

	this.RegisterMoraleChanged(old);

	return { "old": old, "new": this.Morale };
};

Morale.prototype.RecalculateMoraleValues = function()
{
	let oldMaxMorale = this.GetMaxMorale();
	let newMaxMorale = ApplyValueModificationsToEntity("Morale/Max", +this.template.Max, this.entity);
	if (oldMaxMorale != newMaxMorale)
	{
		let newMorale = this.Morale * newMaxMorale/oldMaxMorale;
		this.maxMorale = newMaxMorale;
		this.SetMorale(newMorale);
	}

	let oldRegenRate = this.regenRate;
	this.regenRate = ApplyValueModificationsToEntity("Morale/RegenRate", +this.template.RegenRate, this.entity);

	let oldIdleRegenRate = this.idleRegenRate;
	this.idleRegenRate = ApplyValueModificationsToEntity("Morale/IdleRegenRate", +this.template.IdleRegenRate, this.entity);

	if (this.regenRate != oldRegenRate || this.idleRegenRate != oldIdleRegenRate)
		this.CheckMoraleRegenTimer();
};

Morale.prototype.ApplyMoraleEffects = function(ent)
{
	var cmpModifiersManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_ModifiersManager);
	//TODO: Make this modifiable via template
	cmpModifiersManager.AddModifiers(
		"Demoralized", 
		{
			"Attack/Melee/RepeatTime": [{ "affects": ["Unit"], "multiply": 1.25 }],
			"Attack/Ranged/RepeatTime": [{ "affects": ["Unit"], "multiply": 1.25 }],
			"Builder/Rate": [{ "affects": ["Unit"], "multiply": 0.75 }],
			"ResourceGatherer/BaseSpeed": [{ "affects": ["Unit"], "multiply": 0.75 }]
		},
		ent
	);

	let cmpUnitAI = Engine.QueryInterface(ent, IID_UnitAI);
	if(cmpUnitAI.order)
		cmpUnitAI.SetNextState("INDIVIDUAL.FLEEING")
}

Morale.prototype.RemoveMoraleEffects = function(ents)
{
	if (!ents.length)
		return;
	var cmpModifiersManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_ModifiersManager);
	cmpModifiersManager.RemoveAllModifiers("Demoralized", ents);
}

//
// For Morale Influence
//

// Calculate Morale Influence (alliance, level, and significance)
Morale.prototype.CalculateMoraleInfluence = function(ent, ally)
{
	var cmpMorale = Engine.QueryInterface(ent, IID_Morale);
	if (cmpMorale)
	{
		let alliance = ally ? 1 : -1
		let moralePercentage = cmpMorale.GetMoraleLevel() / 5
		let moraleSignificance = cmpMorale.GetSignificance()
		let moraleMultiplier = this.moraleRegenMultiplier

		return alliance * moralePercentage * moraleSignificance * moraleMultiplier;
	}
}

// Applying morale influence by updating regenRate of all entities in range.
Morale.prototype.ApplyMoraleInfluence = function(ents, ally)
{

	var cmpModifiersManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_ModifiersManager);
	for (let ent of ents)
	{
		let moraleInfluence = this.CalculateMoraleInfluence(ent, ally)
		if (moraleInfluence)
		{
			cmpModifiersManager.AddModifiers(
				(ally ? "MoraleAllies" : "MoraleEnemies") + ent, 
				{
					"Morale/RegenRate": [{ "affects": ["Unit"], "add": moraleInfluence}],
				},
				this.entity,
				true
			);
		}
	}
}

Morale.prototype.RemoveMoraleInfluence = function(ents, ally)
{
	if (!ents.length)
		return;
	for (let ent of ents)
	{
		var cmpModifiersManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_ModifiersManager);
		cmpModifiersManager.RemoveAllModifiers((ally ? "MoraleAllies" : "MoraleEnemies") + ent, this.entity);
	}

}

Morale.prototype.CleanMoraleInfluence = function()
{
	var cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);

	if(this.affectedPlayers)
		this.RemoveMoraleInfluence(this.affectedPlayers, true);
	if(this.affectedPlayersEnemies)
		this.RemoveMoraleInfluence(this.affectedPlayersEnemies, false);
    this.RemoveMoraleInfluence([this.entity], false);

	if (this.rangeQuery)
		cmpRangeManager.DestroyActiveQuery(this.rangeQuery);
	if (this.rangeQueryEnemy)
		cmpRangeManager.DestroyActiveQuery(this.rangeQueryEnemy);

	this.rangeQuery = undefined;
	this.rangeQueryEnemy = undefined;

	var cmpPlayer = Engine.QueryInterface(this.entity, IID_Player);
	if (!cmpPlayer)
		cmpPlayer = QueryOwnerInterface(this.entity);

	if (!cmpPlayer || cmpPlayer.GetState() == "defeated")
		return;

	this.affectedPlayers = cmpPlayer.GetAllies();
	this.rangeQuery = cmpRangeManager.CreateActiveQuery(
		this.entity,
		0,
		this.GetRange(this.entity),
		this.affectedPlayers,
		IID_Identity,
		cmpRangeManager.GetEntityFlagMask("normal"),
		false
	);
	cmpRangeManager.EnableActiveQuery(this.rangeQuery);

	this.affectedPlayersEnemies = cmpPlayer.GetEnemies();
	this.rangeQueryEnemy = cmpRangeManager.CreateActiveQuery(
		this.entity,
		0,
		this.GetRange(this.entity),
		this.affectedPlayersEnemies,
		IID_Identity,
		cmpRangeManager.GetEntityFlagMask("normal"),
		false
	);
	cmpRangeManager.EnableActiveQuery(this.rangeQueryEnemy);

}

// 
Morale.prototype.CauseMoraleDeathDamage = function()
{
	let damageMultiplier = 1; 
	let moraleRange = this.GetRange(this.entity)

	let cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
	if (!cmpPosition || !cmpPosition.IsInWorld())
		return;
	let pos = cmpPosition.GetPosition2D();

	let cmpOwnership = Engine.QueryInterface(this.entity, IID_Ownership);
	let owner = cmpOwnership.GetOwner();
	if (owner == INVALID_PLAYER)
		warn("Unit causing morale death damage does not have any owner.");

	let nearEntsAllies = PositionHelper.EntitiesNearPoint(pos, moraleRange,
		QueryPlayerIDInterface(owner).GetAllies());
	let nearEntsEnemies = PositionHelper.EntitiesNearPoint(pos, moraleRange,
		QueryPlayerIDInterface(owner).GetEnemies());

	let cmpObstructionManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_ObstructionManager);

	// Cycle through all the nearby entities and damage it appropriately based on its distance from the origin.
	for (let ent of nearEntsAllies)
	{
		let moraleDamage = this.CalculateMoraleInfluence(this.entity, true) * this.moraleDeathDamageMultiplier

		// Correct somewhat for the entity's obstruction radius.
		let distance = cmpObstructionManager.DistanceToPoint(ent, pos.x, pos.y);

		damageMultiplier = 1 - distance * distance / (moraleRange * moraleRange);

		// The RangeManager can return units that are too far away (due to approximations there)
		// so the multiplier can end up below 0.
		damageMultiplier = Math.max(0, damageMultiplier);

		let cmpMorale = Engine.QueryInterface(ent, IID_Morale);
		if (cmpMorale)
			cmpMorale.ReduceMorale(damageMultiplier * moraleDamage);
	}

	for (let ent of nearEntsEnemies)
	{
		let moraleDamage = this.CalculateMoraleInfluence(this.entity, true) * this.moraleDeathDamageMultiplier
		let distance = cmpObstructionManager.DistanceToPoint(ent, pos.x, pos.y);

		damageMultiplier = 1 - distance * distance / (moraleRange * moraleRange);
		damageMultiplier = Math.max(0, damageMultiplier);

		let cmpMorale = Engine.QueryInterface(ent, IID_Morale);
		if (cmpMorale)
			cmpMorale.IncreaseMorale(damageMultiplier * moraleDamage);
	}
};

Morale.prototype.OnRangeUpdate = function(msg)
{
	if (msg.tag == this.rangeQuery)
	{
		this.ApplyMoraleInfluence(msg.added, true);
		this.RemoveMoraleInfluence(msg.removed, true);
	}
	if (msg.tag == this.rangeQueryEnemy)
	{
		this.ApplyMoraleInfluence(msg.added, false);
		this.RemoveMoraleInfluence(msg.removed, false);
	}
}

Morale.prototype.OnValueModification = function(msg)
{
	if (msg.component == "Morale")
		this.RecalculateMoraleValues();
};

Morale.prototype.OnOwnershipChanged = function(msg)
{
	this.CleanMoraleInfluence();
	if (msg.to != INVALID_PLAYER)
		this.RecalculateMoraleValues();
};

Morale.prototype.OnDiplomacyChanged = function(msg)
{
	var cmpPlayer = Engine.QueryInterface(this.entity, IID_Player);
	if (cmpPlayer && (cmpPlayer.GetPlayerID() == msg.player || cmpPlayer.GetPlayerID() == msg.otherPlayer) ||
	   IsOwnedByPlayer(msg.player, this.entity) ||
	   IsOwnedByPlayer(msg.otherPlayer, this.entity))
		this.CleanMoraleInfluence();
};

Morale.prototype.OnDestroy = function(msg)
{
	this.CleanMoraleInfluence();
};


Morale.prototype.OnGlobalPlayerDefeated = function(msg)
{
	let cmpPlayer = Engine.QueryInterface(this.entity, IID_Player);
	if (cmpPlayer && cmpPlayer.GetPlayerID() == msg.playerId)
		this.CleanMoraleInfluence();
};

Morale.prototype.RegisterMoraleChanged = function(from)
{
	this.CheckMoraleRegenTimer();
	Engine.PostMessage(this.entity, MT_MoraleChanged, { "from": from, "to": this.Morale });
};

Engine.RegisterComponentType(IID_Morale, "Morale", Morale);
